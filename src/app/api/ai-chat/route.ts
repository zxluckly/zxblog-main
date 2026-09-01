import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import projects from '@/app/projects/list.json'
import siteContent from '@/config/site-content.json'

// 使用 Node.js Runtime，避免 Edge Runtime 出网时的额外限制
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ARK_API_KEY = process.env.ARK_API_KEY
const ARK_MODEL = process.env.ARK_MODEL || 'ep-20260831230602-26bn4'
const ARK_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_RESPONSES_MODEL = process.env.ARK_RESPONSES_MODEL || 'ep-20260831230602-26bn4'
const ARK_RESPONSES_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses'
const ENABLE_SEARCH_USER_LOCATION = process.env.ENABLE_SEARCH_USER_LOCATION !== 'false'
const ARK_REQUEST_TIMEOUT_MS = 90_000
const WEB_SEARCH_MAX_KEYWORD = 2
const WEB_SEARCH_LIMIT = 10
const MAX_SEARCH_TOOL_CALLS = 3

type Project = {
	name: string
	year: number
	image: string
	url?: string
	description: string
	tags: string[]
	github?: string
	npm?: string
	detailImages?: string[]
	detailMarkdown?: string
}

type ToolResult = {
	toolName: string
	result: unknown
}

type ChatContentItem =
	| {
			type: 'text'
			text: string
	  }
	| {
			type: 'image_url'
			image_url: { url: string }
	  }

type ChatMessage = {
	role: 'user' | 'assistant'
	content: string | ChatContentItem[]
}

type ChatRequest = {
	messages: ChatMessage[]
	mode: 'chat' | 'smart_search'
}

type SearchUserLocation = {
	type: 'approximate'
	country?: string
	region?: string
	city?: string
}

type SearchTelemetry = {
	requestId: string
	startedAt: number
	locationSource: 'cloudflare' | 'none'
}

type ArkUpstreamErrorDetails = {
	status: number | null
	statusText: string | null
	body: string | null
	parsedBody: unknown
	headers: {
		contentType: string | null
		retryAfter: string | null
		xRequestId: string | null
		xTraceId: string | null
	}
	overloaded?: boolean
	cause?: string | null
}

class ArkUpstreamError extends Error {
	details: ArkUpstreamErrorDetails

	constructor(details: ArkUpstreamErrorDetails) {
		super(`ARK API Error (${details.status} ${details.statusText}): ${details.body || 'empty body'}`)
		this.name = 'ArkUpstreamError'
		this.details = details
	}
}
const projectList = projects as Project[]

// 初始化 Redis 客户端
const redis =
	process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
		? new Redis({
				url: process.env.KV_REST_API_URL,
				token: process.env.KV_REST_API_TOKEN
			})
		: null

// 速率限制配置
const RATE_LIMIT = {
	PER_MINUTE: 10, // 每分钟最多 10 次请求
	PER_DAY: 100, // 每天最多 100 次请求
	MAX_MESSAGES: 20, // 单次对话最多 20 轮
	MAX_REQUEST_BYTES: 10 * 1024 * 1024,
	MAX_TOTAL_TEXT_LENGTH: 30_000,
	MAX_MESSAGE_TEXT_LENGTH: 8_000,
	MAX_CONTENT_ITEMS_PER_MESSAGE: 4,
	MAX_IMAGES_PER_REQUEST: 2,
	MAX_IMAGE_BYTES: 5 * 1024 * 1024,
	MAX_TOTAL_IMAGE_BYTES: 7 * 1024 * 1024
}

const RATE_LIMIT_PREFIX = 'ai-chat:ratelimit:'
const ALLOWED_MESSAGE_ROLES = new Set<ChatMessage['role']>(['user', 'assistant'])
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', 'zxluky.asia', 'www.zxluky.asia', 'zxlucky.top', 'www.zxlucky.top'])

function normalizeText(value: string): string {
	return value.toLowerCase().replace(/\s+/g, '')
}

function nullableString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null
}

function getProjectSummary(project: Project) {
	return {
		name: project.name,
		year: project.year,
		image: nullableString(project.image),
		url: nullableString(project.url),
		description: project.description,
		tags: project.tags || [],
		github: nullableString(project.github),
		npm: nullableString(project.npm)
	}
}

function getProjectFull(project: Project) {
	return {
		...getProjectSummary(project),
		detailImages: project.detailImages || [],
		detailMarkdown: nullableString(project.detailMarkdown)
	}
}

function getAllProjects() {
	return {
		status: 'success',
		count: projectList.length,
		projects: projectList.map(getProjectSummary),
		facts: {
			projectNames: projectList.map(project => project.name),
			years: projectList.map(project => project.year),
			urls: projectList.flatMap(project => [project.url, project.github, project.npm].filter(Boolean))
		}
	}
}

function getProjectDetail(query: string) {
	const normalizedQuery = normalizeText(query)

	if (!normalizedQuery) {
		return {
			status: 'need_query',
			message: '用户没有提供项目名称或关键词，请让用户补充要查询的项目。',
			projects: projectList.map(project => ({
				name: project.name,
				year: project.year,
				tags: project.tags || []
			}))
		}
	}

	const exactMatch = projectList.find(project => normalizeText(project.name) === normalizedQuery)
	if (exactMatch) {
		return {
			status: 'success',
			matchedBy: 'exact_name',
			project: getProjectFull(exactMatch)
		}
	}

	const nameMatches = projectList.filter(project => normalizeText(project.name).includes(normalizedQuery))
	if (nameMatches.length === 1) {
		return {
			status: 'success',
			matchedBy: 'partial_name',
			project: getProjectFull(nameMatches[0])
		}
	}

	const contentMatches = projectList.filter(project => {
		const searchable = normalizeText([project.name, project.description, project.github || '', project.url || '', ...(project.tags || [])].join(' '))

		return searchable.includes(normalizedQuery)
	})

	if (contentMatches.length === 1) {
		return {
			status: 'success',
			matchedBy: 'content',
			project: getProjectFull(contentMatches[0])
		}
	}

	const candidates = nameMatches.length > 0 ? nameMatches : contentMatches

	return {
		status: candidates.length > 0 ? 'multiple_matches' : 'not_found',
		message:
			candidates.length > 0 ? '找到了多个可能匹配的项目，请让用户指定更准确的项目名称；不要自行选择。' : '未找到匹配项目，请让用户换一个项目名称或关键词。',
		candidates: candidates.map(getProjectSummary),
		allProjects: projectList.map(project => ({
			name: project.name,
			year: project.year,
			tags: project.tags || []
		}))
	}
}

function getSiteContent() {
	const content = siteContent as any
	return {
		status: 'success',
		meta: content.meta,
		socialButtons: (content.socialButtons || []).map((button: any) => ({
			id: button.id,
			type: button.type,
			value: nullableString(button.value),
			label: nullableString(button.label),
			order: button.order
		})),
		beian: content.beian,
		facts: {
			emails: (content.socialButtons || [])
				.filter((button: any) => button.type === 'email')
				.map((button: any) => button.value)
				.filter(Boolean),
			urls: (content.socialButtons || [])
				.filter((button: any) => button.type !== 'email')
				.map((button: any) => button.value)
				.filter(Boolean)
		}
	}
}

function getLastUserText(messages: ChatMessage[]): string {
	const lastUser = [...messages].reverse().find(message => message.role === 'user')
	const content = lastUser?.content

	if (typeof content === 'string') return content
	if (Array.isArray(content)) {
		return content
			.map((item: any) => item?.text || '')
			.filter(Boolean)
			.join('\n')
	}

	return ''
}

function planRequiredTools(userText: string): ToolResult[] {
	const planned: ToolResult[] = []
	const text = normalizeText(userText)

	if (/联系|邮箱|email|qq|github|主页|站点|网站|社交|作者/.test(userText)) {
		planned.push({ toolName: 'get_site_content', result: getSiteContent() })
	}

	if (/全部项目|项目列表|有哪些项目|项目总览|所有项目|项目展示|技术栈|tech_stack/.test(userText)) {
		planned.push({ toolName: 'get_all_projects', result: getAllProjects() })
	}

	const project = projectList.find(item => text.includes(normalizeText(item.name)))
	if (project) {
		planned.push({ toolName: 'get_project_detail', result: getProjectDetail(project.name) })
	}

	return planned
}

function createStreamResponse(body: ReadableStream<Uint8Array> | null) {
	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	})
}

type SseEvent = {
	eventName: string | null
	data: string
}

type SseTextExtractor = (event: SseEvent) => string

function createLeadingMetadataFilter() {
	let pending = ''
	let confirmedAnswer = false
	const metadataStart = '用户现在说'
	const metadataPrefix = /^用户现在说[\s\S]{0,600}?我将(?:以)?[\s\S]{0,600}?(?:回复用户|回答用户|进行回复)[\s\S]{0,200}?[。！？]/

	return {
		push(content: string) {
			if (confirmedAnswer) return content

			pending += content
			while (true) {
				const match = pending.match(metadataPrefix)
				if (!match) break
				pending = pending.slice(match[0].length)
			}

			const mayBeMetadata = metadataStart.startsWith(pending) || pending.startsWith(metadataStart)
			if (!mayBeMetadata || pending.length >= 1024) {
				confirmedAnswer = true
				const visible = pending
				pending = ''
				return visible
			}

			return ''
		},
		flush() {
			const visible = pending
			pending = ''
			return visible
		}
	}
}

function createFilteredStreamResponse(source: ReadableStream<Uint8Array> | null, extractText: SseTextExtractor) {
	if (!source) return createStreamResponse(null)

	const decoder = new TextDecoder()
	const encoder = new TextEncoder()
	const metadataFilter = createLeadingMetadataFilter()
	let buffer = ''

	const transformed = new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = source.getReader()

			const enqueueContent = (content: string) => {
				const visible = metadataFilter.push(content)
				if (visible) controller.enqueue(encoder.encode(createSseChunk(visible)))
			}

			const processEvent = (record: string) => {
				let eventName: string | null = null
				const dataLines: string[] = []

				for (const line of record.split(/\r?\n/)) {
					if (line.startsWith('event:')) eventName = line.slice(6).trim() || null
					if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
				}

				const data = dataLines.join('\n').trim()
				if (!data || data === '[DONE]') return

				const content = extractText({ eventName, data })
				if (content) enqueueContent(content)
			}

			const processCompleteRecords = () => {
				const records = buffer.split(/\r?\n\r?\n/)
				buffer = records.pop() || ''
				for (const record of records) processEvent(record)
			}

			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break
					buffer += decoder.decode(value, { stream: true })
					processCompleteRecords()
				}

				buffer += decoder.decode()
				if (buffer.trim()) processEvent(buffer)

				const remaining = metadataFilter.flush()
				if (remaining) controller.enqueue(encoder.encode(createSseChunk(remaining)))
				controller.close()
			} catch (error) {
				controller.error(error)
			} finally {
				reader.releaseLock()
			}
		}
	})

	return createStreamResponse(transformed)
}

function extractChatCompletionText({ data }: SseEvent): string {
	const parsed = tryParseJson(data) as any
	const content = parsed?.choices?.[0]?.delta?.content
	return typeof content === 'string' ? content : ''
}

function extractResponsesOutputText({ eventName, data }: SseEvent): string {
	const parsed = tryParseJson(data) as any
	const type = parsed?.type || eventName
	if (type !== 'response.output_text.delta') return ''
	return typeof parsed?.delta === 'string' ? parsed.delta : ''
}

function createJsonResponse(body: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...(init?.headers || {})
		}
	})
}

function tryParseJson(value: string): unknown {
	try {
		return JSON.parse(value)
	} catch {
		return null
	}
}

function extractResponseText(delta: unknown): string {
	if (typeof delta === 'string') return delta

	if (Array.isArray(delta)) {
		return delta.map(item => extractResponseText((item as any)?.text ?? (item as any)?.delta ?? item)).join('')
	}

	if (delta && typeof delta === 'object') {
		const record = delta as Record<string, unknown>
		const text = record.text ?? record.delta ?? record.value
		if (typeof text === 'string') return text
		if (Array.isArray(text)) {
			return text.map(item => extractResponseText(item)).join('')
		}
	}

	return ''
}

function createSseChunk(content: string) {
	return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function createSseEvent(event: string, data: unknown) {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getDataUrlByteLength(value: string): number | null {
	const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
	if (!match || !ALLOWED_IMAGE_MIME_TYPES.has(match[1].toLowerCase())) return null

	const encoded = match[2]
	const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
	return (encoded.length / 4) * 3 - padding
}

function validateChatRequest(body: unknown): { request?: ChatRequest; error?: string } {
	if (!isRecord(body) || !Array.isArray(body.messages)) {
		return { error: '无效的消息格式' }
	}

	if (body.messages.length === 0 || body.messages.length > RATE_LIMIT.MAX_MESSAGES) {
		return { error: `对话轮数必须在 1 到 ${RATE_LIMIT.MAX_MESSAGES} 之间` }
	}

	if (body.mode !== 'chat' && body.mode !== 'smart_search') {
		return { error: '无效的对话模式' }
	}

	let totalTextLength = 0
	let imageCount = 0
	let totalImageBytes = 0
	const messages: ChatMessage[] = []

	for (const rawMessage of body.messages) {
		if (!isRecord(rawMessage) || !ALLOWED_MESSAGE_ROLES.has(rawMessage.role as ChatMessage['role'])) {
			return { error: '消息角色无效' }
		}

		const role = rawMessage.role as ChatMessage['role']
		const { content } = rawMessage
		if (typeof content === 'string') {
			if (!content.trim() || content.length > RATE_LIMIT.MAX_MESSAGE_TEXT_LENGTH) {
				return { error: '消息文本长度超出限制' }
			}
			totalTextLength += content.length
			messages.push({ role, content })
			continue
		}

		if (!Array.isArray(content) || content.length === 0 || content.length > RATE_LIMIT.MAX_CONTENT_ITEMS_PER_MESSAGE) {
			return { error: '消息内容格式无效' }
		}

		const items: ChatContentItem[] = []
		for (const rawItem of content) {
			if (!isRecord(rawItem)) return { error: '消息内容格式无效' }

			if (rawItem.type === 'text' && typeof rawItem.text === 'string') {
				if (!rawItem.text.trim() || rawItem.text.length > RATE_LIMIT.MAX_MESSAGE_TEXT_LENGTH) {
					return { error: '消息文本长度超出限制' }
				}
				totalTextLength += rawItem.text.length
				items.push({ type: 'text', text: rawItem.text })
				continue
			}

			if (rawItem.type === 'image_url' && isRecord(rawItem.image_url) && typeof rawItem.image_url.url === 'string') {
				const imageBytes = getDataUrlByteLength(rawItem.image_url.url)
				if (imageBytes === null || imageBytes > RATE_LIMIT.MAX_IMAGE_BYTES) {
					return { error: '图片格式或大小超出限制' }
				}
				imageCount += 1
				totalImageBytes += imageBytes
				items.push({ type: 'image_url', image_url: { url: rawItem.image_url.url } })
				continue
			}

			return { error: '消息内容格式无效' }
		}

		messages.push({ role, content: items })
	}

	if (totalTextLength > RATE_LIMIT.MAX_TOTAL_TEXT_LENGTH) return { error: '消息总文本长度超出限制' }
	if (imageCount > RATE_LIMIT.MAX_IMAGES_PER_REQUEST || totalImageBytes > RATE_LIMIT.MAX_TOTAL_IMAGE_BYTES) {
		return { error: '图片数量或总大小超出限制' }
	}

	return { request: { messages, mode: body.mode } }
}

function getString(value: unknown, maxLength = 120): string | undefined {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim()
	if (!normalized || normalized.length > maxLength || /[\x00-\x1f\x7f]/.test(normalized)) return undefined
	return normalized
}

function getCloudflareLocation(request: Request): SearchUserLocation | undefined {
	if (!ENABLE_SEARCH_USER_LOCATION) return undefined

	const cf = (request as Request & { cf?: unknown }).cf
	if (!isRecord(cf)) return undefined

	const country = getString(cf.country)
	const region = getString(cf.region)
	const city = getString(cf.city)
	if (!country && !region && !city) return undefined

	return {
		type: 'approximate',
		...(country ? { country } : {}),
		...(region ? { region } : {}),
		...(city ? { city } : {})
	}
}

function logSearchTelemetry(event: string, telemetry: SearchTelemetry, fields: Record<string, unknown> = {}) {
	console.info('AI search telemetry', {
		event,
		requestId: telemetry.requestId,
		elapsedMs: Math.round(performance.now() - telemetry.startedAt),
		...fields
	})
}

async function streamArkResponses(body: Record<string, unknown>) {
	const response = await fetch(ARK_RESPONSES_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${ARK_API_KEY}`
		},
		signal: AbortSignal.timeout(ARK_REQUEST_TIMEOUT_MS),
		body: JSON.stringify(body)
	})

	if (!response.ok) {
		const errorText = await response.text()
		const details: ArkUpstreamErrorDetails = {
			status: response.status,
			statusText: response.statusText,
			body: errorText,
			parsedBody: tryParseJson(errorText),
			headers: {
				contentType: response.headers.get('content-type'),
				retryAfter: response.headers.get('retry-after'),
				xRequestId: response.headers.get('x-request-id'),
				xTraceId: response.headers.get('x-tt-logid') || response.headers.get('x-trace-id')
			}
		}

		console.error('ARK Responses API Error:', details)
		throw new ArkUpstreamError(details)
	}

	return response
}

function getSearchUsage(parsed: unknown) {
	if (!isRecord(parsed) || parsed.type !== 'response.completed' || !isRecord(parsed.response)) return null

	const usage = parsed.response.usage
	if (!isRecord(usage)) return { webSearch: null, hasDetails: false }

	const toolUsage = isRecord(usage.tool_usage) ? usage.tool_usage : null
	const toolUsageDetails = isRecord(usage.tool_usage_details) ? usage.tool_usage_details : null
	const rawWebSearchDetails = toolUsageDetails?.web_search
	const webSearchDetails = isRecord(rawWebSearchDetails)
		? Object.fromEntries(
				Object.entries(rawWebSearchDetails).filter(
					([key, value]) => ['count', 'total'].includes(key) && (typeof value === 'number' || typeof value === 'boolean')
				)
			)
		: undefined
	const webSearch = typeof toolUsage?.web_search === 'number' && Number.isFinite(toolUsage.web_search) ? toolUsage.web_search : null

	return {
		webSearch,
		details: webSearchDetails,
		hasDetails: rawWebSearchDetails !== undefined
	}
}

function getSearchStatus(parsed: unknown): 'searching' | 'search_completed' | null {
	if (!isRecord(parsed) || typeof parsed.type !== 'string') return null
	if (parsed.type === 'response.web_search_call.in_progress' || parsed.type === 'response.web_search_call.searching') {
		return 'searching'
	}
	return parsed.type === 'response.web_search_call.completed' ? 'search_completed' : null
}

function createResponsesStreamResponse(source: ReadableStream<Uint8Array> | null, telemetry: SearchTelemetry) {
	if (!source) return createStreamResponse(null)

	const decoder = new TextDecoder()
	const encoder = new TextEncoder()
	const metadataFilter = createLeadingMetadataFilter()
	let buffer = ''
	let emittedUsage = false
	let firstTextLogged = false
	let firstUpstreamByteLogged = false

	const transformed = new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = source.getReader()

			const enqueue = (value: string) => controller.enqueue(encoder.encode(value))
			const enqueueText = (content: string) => {
				const visible = metadataFilter.push(content)
				if (!visible) return
				if (!firstTextLogged) {
					firstTextLogged = true
					logSearchTelemetry('first_visible_text', telemetry)
				}
				enqueue(createSseChunk(visible))
			}

			const processEvent = (record: string) => {
				const dataLines: string[] = []
				for (const line of record.split(/\r?\n/)) {
					if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
				}

				const data = dataLines.join('\n').trim()
				if (!data || data === '[DONE]') return
				const parsed = tryParseJson(data)

				const status = getSearchStatus(parsed)
				if (status) {
					logSearchTelemetry(status, telemetry)
					enqueue(createSseEvent('status', { phase: status }))
				}

				const usage = getSearchUsage(parsed)
				if (usage && !emittedUsage) {
					emittedUsage = true
					logSearchTelemetry('completed', telemetry, usage)
					enqueue(
						createSseEvent('usage', {
							type: 'usage',
							webSearch: usage.webSearch,
							details: usage.details,
							detailsAvailable: usage.hasDetails
						})
					)
					enqueue(createSseEvent('status', { phase: 'completed' }))
				}

				const content = extractResponsesOutputText({ eventName: null, data })
				if (content) enqueueText(content)
			}

			const processCompleteRecords = () => {
				const records = buffer.split(/\r?\n\r?\n/)
				buffer = records.pop() || ''
				for (const record of records) processEvent(record)
			}

			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break
					if (!firstUpstreamByteLogged) {
						firstUpstreamByteLogged = true
						logSearchTelemetry('first_upstream_byte', telemetry)
					}
					buffer += decoder.decode(value, { stream: true })
					processCompleteRecords()
				}

				buffer += decoder.decode()
				if (buffer.trim()) processEvent(buffer)
				const remaining = metadataFilter.flush()
				if (remaining) enqueueText(remaining)
				logSearchTelemetry('stream_closed', telemetry)
				controller.close()
			} catch (error) {
				logSearchTelemetry('stream_error', telemetry)
				controller.error(error)
			} finally {
				reader.releaseLock()
			}
		}
	})

	return createStreamResponse(transformed)
}

async function fetchArkResponses(body: Record<string, unknown>) {
	return streamArkResponses(body)
}

function createResponsesInput(messages: ChatMessage[]) {
	return messages.map(message => ({
		role: message.role,
		content: Array.isArray(message.content)
			? message.content.map((item: any) => {
					if (item?.type === 'image_url' && item.image_url?.url) {
						return {
							type: 'input_image',
							image_url: item.image_url.url
						}
					}

					if (item?.type === 'text' && typeof item.text === 'string') {
						return {
							type: 'input_text',
							text: item.text
						}
					}

					return item
				})
			: [{ type: 'input_text', text: String(message.content ?? '') }]
	}))
}

async function streamResponsesAnswer(messages: ChatMessage[], instructions: string, location?: SearchUserLocation) {
	return fetchArkResponses({
		model: ARK_RESPONSES_MODEL,
		instructions,
		tools: [
			{
				type: 'web_search',
				max_keyword: WEB_SEARCH_MAX_KEYWORD,
				limit: WEB_SEARCH_LIMIT,
				...(location ? { user_location: location } : {})
			}
		],
		max_tool_calls: MAX_SEARCH_TOOL_CALLS,
		stream: true,
		input: createResponsesInput(messages)
	})
}

function serializeUnknownError(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			...(error as any)
		}
	}

	if (typeof error === 'object' && error !== null) {
		return { ...(error as Record<string, unknown>) }
	}

	return { value: error }
}

async function fetchArk(body: Record<string, unknown>) {
	try {
		const response = await fetch(ARK_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ARK_API_KEY}`
			},
			body: JSON.stringify(body)
		})

		if (!response.ok) {
			const errorText = await response.text()
			const details: ArkUpstreamErrorDetails = {
				status: response.status,
				statusText: response.statusText,
				body: errorText,
				parsedBody: tryParseJson(errorText),
				headers: {
					contentType: response.headers.get('content-type'),
					retryAfter: response.headers.get('retry-after'),
					xRequestId: response.headers.get('x-request-id'),
					xTraceId: response.headers.get('x-tt-logid') || response.headers.get('x-trace-id')
				}
			}

			console.error('ARK API Error:', details)
			throw new ArkUpstreamError(details)
		}

		return response
	} catch (error) {
		if (!(error instanceof ArkUpstreamError)) {
			console.error('ARK API Fetch Exception:', serializeUnknownError(error))
		}
		throw error
	}
}

function createFactInstruction(toolResults: ToolResult[]) {
	return `以下是服务端工具返回的唯一可信事实源。你可以总结和组织语言，但事实值必须逐字符引用，尤其是项目名、年份、邮箱、QQ、GitHub、URL、技术栈。缺失字段为 null 时只能说“源数据未提供”，禁止补全或猜测。请输出合法 Markdown，禁止输出原始 HTML。\n\n${JSON.stringify(toolResults, null, 2)}`
}

async function streamFinalAnswer(messages: Array<ChatMessage | { role: 'system'; content: string }>, toolResults: ToolResult[]) {
	return fetchArk({
		model: ARK_MODEL,
		messages: [
			...messages,
			{
				role: 'system',
				content: createFactInstruction(toolResults)
			}
		],
		stream: true
	})
}

// 获取客户端标识。Cloudflare 会在边缘覆盖 CF-Connecting-IP；仅在显式配置的可信代理后读取转发头。
function getClientId(request: Request): string {
	const cloudflareIp = request.headers.get('cf-connecting-ip')
	const trustedProxyIp =
		process.env.TRUST_PROXY_HEADERS === 'true' ? request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : null
	const ip = cloudflareIp || trustedProxyIp || 'unknown'
	const userAgent = request.headers.get('user-agent') || 'unknown'
	return createHash('sha256')
		.update(`${ip}\n${userAgent.slice(0, 200)}`)
		.digest('hex')
}

const RATE_LIMIT_SCRIPT = `
local minuteCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local dayCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local minuteLimit = tonumber(ARGV[1])
local dayLimit = tonumber(ARGV[2])
local minuteTtl = tonumber(ARGV[3])
local dayTtl = tonumber(ARGV[4])

if dayCount >= dayLimit then
	return {0, redis.call('TTL', KEYS[2])}
end
if minuteCount >= minuteLimit then
	return {0, redis.call('TTL', KEYS[1])}
end

local nextMinute = redis.call('INCR', KEYS[1])
if nextMinute == 1 then redis.call('EXPIRE', KEYS[1], minuteTtl) end
local nextDay = redis.call('INCR', KEYS[2])
if nextDay == 1 then redis.call('EXPIRE', KEYS[2], dayTtl) end
return {1, 0}
`

// 检查速率限制。脚本将读取、判断、递增和过期时间设置合并为一个 Redis 原子操作。
async function checkRateLimit(clientId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
	if (!redis) {
		console.error('Redis not available, rejecting AI chat request')
		return { allowed: false, retryAfter: 60 }
	}

	const minuteKey = `${RATE_LIMIT_PREFIX}minute:${clientId}`
	const dayKey = `${RATE_LIMIT_PREFIX}day:${clientId}`

	try {
		const result = await redis.eval<[number, number, number, number], [number, number]>(
			RATE_LIMIT_SCRIPT,
			[minuteKey, dayKey],
			[RATE_LIMIT.PER_MINUTE, RATE_LIMIT.PER_DAY, 60, 86400]
		)
		const [allowed, ttl] = result
		return allowed === 1 ? { allowed: true } : { allowed: false, retryAfter: ttl > 0 ? ttl : 60 }
	} catch (error) {
		console.error('Rate limit check error:', error)
		return { allowed: false, retryAfter: 60 }
	}
}

function isAllowedOriginUrl(value: string): boolean {
	try {
		const url = new URL(value)
		return (url.protocol === 'http:' || url.protocol === 'https:') && ALLOWED_ORIGIN_HOSTS.has(url.hostname)
	} catch {
		return false
	}
}

// 验证请求来源
function validateOrigin(request: Request): boolean {
	const origin = request.headers.get('origin')
	if (origin) return isAllowedOriginUrl(origin)

	const referer = request.headers.get('referer')
	return Boolean(referer && isAllowedOriginUrl(referer))
}

const SYSTEM_PROMPT = `你是真寻，ZX 的网站助手。

你可以友好、轻松地总结网站、作者和项目内容，可用颜文字，鼓励用户留言交流。但所有事实都必须来自服务端注入的可信资料或用户本轮明确提供的信息。

事实规则：
- 服务端会在需要时自动注入作者主页、联系方式、项目列表或项目详情等可信资料；你不需要也不能主动输出工具调用。
- 禁止输出类似 <|FunctionCallBegin|>、<|FunctionCallEnd|>、tool_call、get_site_content、get_all_projects、get_project_detail 的工具调用标记或伪代码。
- 如果服务端没有注入相关可信资料，不得凭记忆回答联系方式、项目年份、项目名称、邮箱、QQ 或任何 URL。
- 可信资料中的邮箱、QQ、GitHub、URL、项目名和年份必须逐字符保留，不得缩写、截断、补全、改写或翻译。
- 可信资料字段为 null、空字符串或未提供时，只能说明“源数据未提供”，不得自行生成。
- 多候选项目时必须让用户进一步指定项目，不要猜。

输出规则：
- 使用合法 Markdown 输出，可以自然总结，不要机械模板化。
- 列表和链接要使用标准 Markdown 语法。
- 禁止输出原始 HTML。`

const SEARCH_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

当前处于智能搜索模式。必要时请使用 web_search 工具检索最新互联网信息。`

export async function POST(request: Request) {
	try {
		// 1. 验证 API Key 配置
		if (!ARK_API_KEY) {
			console.error('ARK_API_KEY not configured')
			return NextResponse.json({ error: 'ARK_API_KEY 未配置，请在环境变量中设置' }, { status: 500 })
		}

		// 2. 验证请求来源
		if (!validateOrigin(request)) {
			console.warn('Invalid origin:', request.headers.get('origin'))
			return NextResponse.json({ error: '无效的请求来源' }, { status: 403 })
		}

		// 3. 检查速率限制
		const clientId = getClientId(request)
		const rateLimitResult = await checkRateLimit(clientId)

		if (!rateLimitResult.allowed) {
			return NextResponse.json(
				{
					error: '请求过于频繁，请稍后再试',
					retryAfter: rateLimitResult.retryAfter
				},
				{
					status: 429,
					headers: {
						'Retry-After': String(rateLimitResult.retryAfter || 60)
					}
				}
			)
		}

		// 4. 验证请求体
		const contentLength = Number(request.headers.get('content-length') || 0)
		if (Number.isFinite(contentLength) && contentLength > RATE_LIMIT.MAX_REQUEST_BYTES) {
			return NextResponse.json({ error: '请求体大小超出限制' }, { status: 413 })
		}

		const rawBody = await request.text()
		if (Buffer.byteLength(rawBody, 'utf8') > RATE_LIMIT.MAX_REQUEST_BYTES) {
			return NextResponse.json({ error: '请求体大小超出限制' }, { status: 413 })
		}

		const body = tryParseJson(rawBody)
		const validation = validateChatRequest(body)
		if (!validation.request) {
			return NextResponse.json({ error: validation.error || '无效的消息格式' }, { status: 400 })
		}

		const { messages: safeMessages, mode } = validation.request
		const isSearchMode = mode === 'smart_search'
		const messagesWithSystem: Array<ChatMessage | { role: 'system'; content: string }> = [
			{
				role: 'system',
				content: SYSTEM_PROMPT
			},
			...safeMessages
		]

		if (isSearchMode) {
			const location = getCloudflareLocation(request)
			const telemetry: SearchTelemetry = {
				requestId: crypto.randomUUID(),
				startedAt: performance.now(),
				locationSource: location ? 'cloudflare' : 'none'
			}
			logSearchTelemetry('request_received', telemetry, { hasLocation: Boolean(location) })

			console.log('Sending request to ARK Responses API:', {
				model: ARK_RESPONSES_MODEL,
				messageCount: safeMessages.length,
				mode: 'smart_search',
				clientId: clientId.slice(0, 20) + '...'
			})

			const response = await streamResponsesAnswer(safeMessages, SEARCH_SYSTEM_PROMPT, location)
			logSearchTelemetry('upstream_connected', telemetry)
			return createResponsesStreamResponse(response.body, telemetry)
		}

		const userText = getLastUserText(safeMessages)
		const plannedToolResults = planRequiredTools(userText)

		console.log('Sending request to ARK API:', {
			model: ARK_MODEL,
			messageCount: messagesWithSystem.length,
			plannedToolCount: plannedToolResults.length,
			mode: 'chat',
			clientId: clientId.slice(0, 20) + '...'
		})

		if (plannedToolResults.length > 0) {
			const response = await streamFinalAnswer(messagesWithSystem, plannedToolResults)
			return createFilteredStreamResponse(response.body, extractChatCompletionText)
		}

		const response = await fetchArk({
			model: ARK_MODEL,
			messages: messagesWithSystem,
			stream: true
		})

		return createFilteredStreamResponse(response.body, extractChatCompletionText)
	} catch (error: any) {
		if (error instanceof ArkUpstreamError) {
			console.error('AI Chat Upstream Error:', error.details)
			const upstreamStatus = error.details.status ?? 502
			return NextResponse.json(
				{
					error: error.message,
					upstream: error.details
				},
				{ status: upstreamStatus >= 400 ? upstreamStatus : 502 }
			)
		}

		console.error('AI Chat Error:', serializeUnknownError(error))
		return NextResponse.json({ error: error instanceof Error ? error.message : '服务器错误' }, { status: 500 })
	}
}

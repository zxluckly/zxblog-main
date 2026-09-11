'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface AIReasoningBlockProps {
	content: string
	isStreaming?: boolean
}

// 思考链展示块，默认折叠，由用户手动展开。
export function AIReasoningBlock({ content, isStreaming = false }: AIReasoningBlockProps) {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<div className='rounded-lg border border-dashed bg-white/60 text-xs'>
			<button
				type='button'
				onClick={() => setIsOpen(v => !v)}
				aria-expanded={isOpen}
				className='text-secondary hover:text-primary flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors'>
				<ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
				<span className={isStreaming ? 'animate-pulse' : ''}>{isStreaming ? '正在思考…' : '已深度思考'}</span>
			</button>

			{isOpen && <div className='text-secondary max-h-60 overflow-y-auto border-t border-dashed px-2.5 py-2 leading-relaxed break-words whitespace-pre-wrap'>{content}</div>}
		</div>
	)
}

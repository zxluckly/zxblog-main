'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'

interface Tag {
	text: string
	color: string
}

const colorPalette = [
	'#61DAFB', '#3178C6', '#339933', '#06B6D4', '#4FC08D',
	'#3776AB', '#2496ED', '#F05032', '#F7DF1E', '#1572B6',
	'#E34F26', '#47A248', '#4169E1', '#DC382D', '#E10098',
	'#009688', '#8DD6F9', '#646CFF', '#FF9900', '#FCC624',
	'#009639', '#4479A1', '#FF6B6B', '#4ECDC4', '#45B7D1',
	'#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
]

interface TagPosition {
	tag: Tag
	top: number
	speed: number
	startXvw: number
}

interface DanmakuTagsProps {
	tags?: string[]
}

const EXIT_GAP_PX = 24

function getRandomColor(): string {
	return colorPalette[Math.floor(Math.random() * colorPalette.length)]
}

function isOverlapping(pos1: TagPosition, pos2: TagPosition, tagHeight: number = 40): boolean {
	const verticalGap = 10
	return Math.abs(pos1.top - pos2.top) < tagHeight + verticalGap
}

function getRandomSpeed(): number {
	return 0.7 + Math.random() * 1.1
}

function getRandomStartXvw(): number {
	return Math.random() * 120
}

function generatePositions(tagTexts: string[]): TagPosition[] {
	const positions: TagPosition[] = []
	const minTop = 5
	const maxTop = 85
	const maxAttempts = 50

	for (const text of tagTexts) {
		let attempts = 0
		let position: TagPosition | null = null

		while (attempts < maxAttempts) {
			const candidatePosition: TagPosition = {
				tag: { text, color: getRandomColor() },
				top: minTop + Math.random() * (maxTop - minTop),
				speed: getRandomSpeed(),
				startXvw: getRandomStartXvw()
			}

			const hasOverlap = positions.some(pos => isOverlapping(pos, candidatePosition))
			if (!hasOverlap) {
				position = candidatePosition
				break
			}

			attempts++
		}

		if (position) {
			positions.push(position)
		} else {
			positions.push({
				tag: { text, color: getRandomColor() },
				top: minTop + Math.random() * (maxTop - minTop),
				speed: getRandomSpeed(),
				startXvw: getRandomStartXvw()
			})
		}
	}

	return positions
}

const defaultTagTexts = [
	'Vue.js', 'UniApp', 'HTML5', 'CSS3', 'JavaScript', 'Element UI', 'ECharts',
	'React', 'Next.js', 'TypeScript', 'Tailwind CSS', 'Motion',
	'Python', 'Java', 'Spring Boot', 'Django', 'Flask', 'Node.js', 'REST API',
	'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Neo4j', 'Hadoop', 'Spark',
	'OpenCV', 'YOLO', 'YOLO11', 'TensorFlow', 'PyTorch', 'CNN', 'LSTM',
	'Git', 'Docker', 'Linux', 'Nginx', '阿里云', 'Vercel', 'Github API'
]

function DanmakuTagContent({ position }: { position: TagPosition }) {
	return (
		<>
			<div className='h-2 w-2 rounded-full' style={{ backgroundColor: position.tag.color }} />
			<span
				className='whitespace-nowrap text-sm font-medium'
				style={{
					color: position.tag.color,
					textShadow: `0 0 10px ${position.tag.color}40`
				}}
			>
				{position.tag.text}
			</span>
		</>
	)
}

function DanmakuTag({ position }: { position: TagPosition }) {
	const [loopFromRight, setLoopFromRight] = useState(false)
	const [viewportWidth, setViewportWidth] = useState(0)
	const [tagWidth, setTagWidth] = useState(0)
	const tagRef = useRef<HTMLDivElement | null>(null)

	useLayoutEffect(() => {
		const update = () => {
			setViewportWidth(window.innerWidth)
			setTagWidth(tagRef.current?.offsetWidth ?? 0)
		}

		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	}, [])

	const ready = viewportWidth > 0 && tagWidth > 0
	const speedPx = (position.speed * viewportWidth) / 100
	const startPx = (position.startXvw * viewportWidth) / 100
	const loopStartPx = viewportWidth
	const endPx = -(tagWidth + EXIT_GAP_PX)
	const firstPhaseDuration = (startPx - endPx) / speedPx
	const loopDuration = (loopStartPx - endPx) / speedPx
	const className = 'absolute left-0 flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 backdrop-blur-sm'
	const style = {
		top: `${position.top}%`,
		borderColor: `${position.tag.color}30`,
		backgroundColor: `${position.tag.color}10`
	}

	if (!ready) {
		return (
			<div ref={tagRef} className={className} style={{ ...style, opacity: 0 }}>
				<DanmakuTagContent position={position} />
			</div>
		)
	}

	return (
		<motion.div
			ref={tagRef}
			key={loopFromRight ? 'loop' : 'first'}
			className={className}
			style={style}
			initial={{ x: loopFromRight ? loopStartPx : startPx }}
			animate={{ x: endPx }}
			transition={{
				duration: loopFromRight ? loopDuration : firstPhaseDuration,
				ease: 'linear',
				delay: 0,
				...(loopFromRight ? { repeat: Infinity } : {})
			}}
			onAnimationComplete={() => {
				if (!loopFromRight) {
					setLoopFromRight(true)
				}
			}}
		>
			<DanmakuTagContent position={position} />
		</motion.div>
	)
}

export default function DanmakuTags({ tags = defaultTagTexts }: DanmakuTagsProps) {
	const [mounted, setMounted] = useState(false)
	const positions = useMemo(() => generatePositions(tags), [tags])

	useEffect(() => {
		setMounted(true)
	}, [])

	if (!mounted) return null

	return (
		<div className='pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-40 max-sm:opacity-20'>
			{positions.map((position, index) => (
				<DanmakuTag key={index} position={position} />
			))}
		</div>
	)
}

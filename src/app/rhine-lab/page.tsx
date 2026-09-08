'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function RhineLabPage() {
	const [isLandscape, setIsLandscape] = useState(true)
	const [isMobile, setIsMobile] = useState(false)

	useEffect(() => {
		const checkOrientation = () => {
			const mobile = window.innerWidth < 768
			const landscape = window.innerHeight < window.innerWidth
			setIsMobile(mobile)
			setIsLandscape(landscape)
		}

		checkOrientation()
		window.addEventListener('resize', checkOrientation)
		window.addEventListener('orientationchange', checkOrientation)

		return () => {
			window.removeEventListener('resize', checkOrientation)
			window.removeEventListener('orientationchange', checkOrientation)
		}
	}, [])

	// 移动端且非横屏时显示提示
	if (isMobile && !isLandscape) {
		return (
			<div className='fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#e8e5e1] px-6'>
				<div className='relative w-full max-w-md'>
					{/* 背景装饰 */}
					<div className='absolute -left-4 -top-4 h-24 w-24 border-l-2 border-t-2 border-[#171713] opacity-20' />
					<div className='absolute -bottom-4 -right-4 h-24 w-24 border-b-2 border-r-2 border-[#171713] opacity-20' />

					{/* 主内容 */}
					<div className='relative space-y-6 border-2 border-[#171713] bg-[#e8e5e1] p-8 text-center'>
						{/* 标题区域 */}
						<div className='space-y-2'>
							<div className='text-xs font-bold uppercase tracking-wider text-[#171713] opacity-60'>
								ORIENTATION REQUIRED
							</div>
							<h1 className='font-mono text-xl font-bold text-[#171713]'>
								请旋转设备
							</h1>
						</div>

						{/* 图标指示 */}
						<div className='flex items-center justify-center gap-4 py-4'>
							<svg
								className='h-12 w-12 text-[#171713]'
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								viewBox='0 0 24 24'
							>
								<rect x='5' y='3' width='14' height='18' rx='2' />
								<path d='M12 18h.01' />
							</svg>
							<div className='text-2xl text-[#171713] opacity-40'>→</div>
							<svg
								className='h-12 w-12 rotate-90 text-[#171713]'
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								viewBox='0 0 24 24'
							>
								<rect x='5' y='3' width='14' height='18' rx='2' />
								<path d='M12 18h.01' />
							</svg>
						</div>

						{/* 说明文字 */}
						<div className='space-y-3'>
							<p className='font-mono text-sm text-[#171713] opacity-80'>
								三维档案终端需要横屏模式
							</p>
							<p className='text-xs text-[#171713] opacity-60'>
								为获得最佳交互体验，请将设备旋转至横向
							</p>
						</div>

						{/* 分隔线 */}
						<div className='relative py-2'>
							<div className='absolute inset-0 flex items-center'>
								<div className='w-full border-t border-[#171713] opacity-20' />
							</div>
							<div className='relative flex justify-center'>
								<span className='bg-[#e8e5e1] px-3 font-mono text-xs text-[#171713] opacity-40'>
									OR
								</span>
							</div>
						</div>

						{/* 返回按钮 */}
						<Link
							href='/'
							className='inline-flex items-center gap-2 border border-[#171713] bg-[#e8e5e1] px-4 py-2 font-mono text-xs font-medium text-[#171713] transition-all hover:bg-[#171713] hover:text-[#e8e5e1]'
						>
							<svg
								className='h-3 w-3'
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								viewBox='0 0 24 24'
							>
								<path
									strokeLinecap='round'
									strokeLinejoin='round'
									d='M10 19l-7-7m0 0l7-7m-7 7h18'
								/>
							</svg>
							RETURN TO MAIN
						</Link>
					</div>

					{/* 底部标识 */}
					<div className='mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-[#171713] opacity-40'>
						ZX LUCKY · PROJECT ARCHIVE
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className='fixed inset-0 z-50 flex flex-col bg-background'>
			{/* 顶部返回栏 */}
			<div className='flex items-center justify-between border-b px-6 py-4'>
							<div className='w-20' />
							<h1 className='text-primary text-lg font-medium'>ZX LUCKY · PROJECT ARCHIVE</h1>
							<div className='w-20' />
			</div>

			{/* iframe 容器 - 使用同源子路径 */}
			<div className='relative flex-1'>
				<iframe
					src='/rhinelab/index.html'
					className='h-full w-full border-0'
					title='RhineLabUI'
					allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
				/>
			</div>
		</div>
	)
}

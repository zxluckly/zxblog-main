'use client'

import Link from 'next/link'

export default function RhineLabPage() {
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

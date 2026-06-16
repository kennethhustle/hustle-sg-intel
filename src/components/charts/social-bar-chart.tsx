'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts'
import { formatNumber } from '@/lib/utils'

interface SocialBarData {
  name: string
  followers: number | null
  color: string
  is_hustle: boolean
}

interface SocialBarChartProps {
  data: SocialBarData[]
  title?: string
  maxItems?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null
  const item = payload[0]
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-medium text-white mb-1">{item.payload.name}</p>
      <p className="text-xs text-slate-400">
        Followers:{' '}
        <span className="text-white font-medium">
          {item.payload.followers !== null
            ? formatNumber(item.payload.followers)
            : 'DATA UNAVAILABLE'}
        </span>
      </p>
      {item.payload.is_hustle && (
        <p className="text-xs text-indigo-400 mt-1">Our company</p>
      )}
    </div>
  )
}

export function SocialBarChart({ data, title, maxItems = 10 }: SocialBarChartProps) {
  const chartData = data
    .slice(0, maxItems)
    .map((d) => ({
      ...d,
      displayFollowers: d.followers ?? 0,
      // Short name for x-axis
      shortName:
        d.name.length > 12 ? d.name.split(' ').map((w) => w[0]).join('') : d.name,
    }))
    .sort((a, b) => b.displayFollowers - a.displayFollowers)

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        No data available
      </div>
    )
  }

  return (
    <div className="w-full">
      {title && (
        <h3 className="text-sm font-medium text-slate-400 mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 10, left: 10, bottom: 5 }}
          barSize={32}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1e293b"
            vertical={false}
          />
          <XAxis
            dataKey="shortName"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatNumber(v)}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b' }} />
          <Bar dataKey="displayFollowers" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.is_hustle ? '#818cf8' : entry.color}
                opacity={entry.is_hustle ? 1 : 0.7}
                stroke={entry.is_hustle ? '#6366f1' : 'none'}
                strokeWidth={entry.is_hustle ? 1.5 : 0}
              />
            ))}
            <LabelList
              dataKey="displayFollowers"
              position="top"
              formatter={(v: number) => (v > 0 ? formatNumber(v) : 'N/A')}
              style={{ fill: '#94a3b8', fontSize: 10 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

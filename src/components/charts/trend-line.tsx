'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { formatNumber, formatDate } from '@/lib/utils'

interface TrendDataPoint {
  date: string
  [competitorName: string]: number | string | null
}

interface TrendLineProps {
  data: TrendDataPoint[]
  competitors: Array<{ name: string; color: string; is_hustle: boolean }>
  title?: string
  height?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl max-w-xs">
      <p className="text-xs font-medium text-slate-400 mb-2">{formatDate(label)}</p>
      {payload.map((entry: { name: string; value: number | null; color: string }) => (
        <div key={entry.name} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-slate-300 truncate max-w-[100px]">{entry.name}</span>
          <span className="text-xs font-medium text-white ml-auto">
            {entry.value !== null ? formatNumber(entry.value) : 'N/A'}
          </span>
        </div>
      ))}
    </div>
  )
}

export function TrendLine({ data, competitors, title, height = 260 }: TrendLineProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        No trend data available
      </div>
    )
  }

  return (
    <div className="w-full">
      {title && (
        <h3 className="text-sm font-medium text-slate-400 mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1e293b"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => {
              const d = new Date(v)
              return `${d.getDate()}/${d.getMonth() + 1}`
            }}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatNumber(v)}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span style={{ color: '#94a3b8', fontSize: 11 }}>{value}</span>
            )}
          />
          {competitors.map((comp) => (
            <Line
              key={comp.name}
              type="monotone"
              dataKey={comp.name}
              stroke={comp.is_hustle ? '#818cf8' : comp.color}
              strokeWidth={comp.is_hustle ? 2.5 : 1.5}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

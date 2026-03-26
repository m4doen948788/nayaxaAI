import React, { useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, BarChart2, AlertTriangle } from 'lucide-react';

interface ChartDataPoint {
  label: string;
  value: number;
}

interface ChartSeries {
  name: string;
  data: ChartDataPoint[];
}

interface ChartSpec {
  type: 'bar' | 'column' | 'line' | 'pie' | 'donut';
  title: string;
  data?: ChartDataPoint[];
  series?: ChartSeries[];
  unit?: string;
  color?: string;
}

const COLOR_PALETTES: Record<string, string[]> = {
  indigo: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff', '#4f46e5', '#4338ca', '#3730a3'],
  emerald: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5', '#059669', '#047857', '#065f46'],
  rose:   ['#f43f5e', '#fb7185', '#fda4af', '#fecdd3', '#ffe4e6', '#e11d48', '#be123c', '#9f1239'],
  amber:  ['#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7', '#d97706', '#b45309', '#92400e'],
  sky:    ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#e0f2fe', '#0284c7', '#0369a1', '#075985'],
};

const BAR_HEIGHT = 36;
const CHART_PADDING = { top: 60, right: 30, bottom: 40, left: 160 };

function NayaxaBarChart({ data, unit, colors, width }: { data: ChartDataPoint[], unit: string, colors: string[], width: number }) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = data.length * BAR_HEIGHT;
  const totalHeight = innerHeight + CHART_PADDING.top + CHART_PADDING.bottom;

  return (
    <svg width={width} height={totalHeight} style={{ display: 'block', overflow: 'visible' }}>
      {data.map((d, i) => {
        const barWidth = (d.value / maxValue) * innerWidth;
        const y = CHART_PADDING.top + i * BAR_HEIGHT + 6;
        const color = colors[i % colors.length];
        return (
          <g key={i}>
            <rect x={CHART_PADDING.left} y={y} width={innerWidth} height={BAR_HEIGHT - 12} rx={4} fill="#f1f5f9" />
            <rect x={CHART_PADDING.left} y={y} width={Math.max(barWidth, 2)} height={BAR_HEIGHT - 12} rx={4} fill={color} />
            <text x={CHART_PADDING.left - 8} y={y + (BAR_HEIGHT - 12) / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#475569" fontWeight="500">{d.label}</text>
            <text x={CHART_PADDING.left + barWidth + 6} y={y + (BAR_HEIGHT - 12) / 2} dominantBaseline="middle" fontSize={11} fontWeight="bold" fill={color}>{d.value}{unit}</text>
          </g>
        );
      })}
    </svg>
  );
}

function NayaxaColumnChart({ data, unit, colors, width }: { data: ChartDataPoint[], unit: string, colors: string[], width: number }) {
  const PAD = { top: 60, right: 20, bottom: 60, left: 40 };
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = 180;
  const totalHeight = innerHeight + PAD.top + PAD.bottom;
  const barWidth = Math.max(innerWidth / data.length - 8, 10);

  return (
    <svg width={width} height={totalHeight} style={{ display: 'block', overflow: 'visible' }}>
      {data.map((d, i) => {
        const barH = (d.value / maxValue) * innerHeight;
        const x = PAD.left + i * (innerWidth / data.length) + (innerWidth / data.length - barWidth) / 2;
        const y = PAD.top + innerHeight - barH;
        const color = colors[i % colors.length];
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={Math.max(barH, 2)} rx={4} fill={color} />
            <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight="bold" fill={color}>{d.value}{unit}</text>
            <text x={x + barWidth / 2} y={PAD.top + innerHeight + 14} textAnchor="middle" fontSize={9} fill="#64748b" transform={`rotate(15, ${x + barWidth / 2}, ${PAD.top + innerHeight + 14})`}>
              {d.label.length > 12 ? d.label.slice(0, 10) + '…' : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function NayaxaLineChart({ data, unit, colors, width }: { data: ChartDataPoint[], unit: string, colors: string[], width: number }) {
  const PAD = { top: 60, right: 30, bottom: 60, left: 40 };
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = 180;
  const color = colors[0];
  const points = data.map((d, i) => ({
    x: PAD.left + (i / Math.max(data.length - 1, 1)) * innerWidth,
    y: PAD.top + innerHeight - (d.value / maxValue) * innerHeight,
    ...d
  }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={width} height={innerHeight + PAD.top + PAD.bottom} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill={color} />
          <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={10} fontWeight="bold" fill={color}>{p.value}{unit}</text>
          <text x={p.x} y={PAD.top + innerHeight + 14} textAnchor="middle" fontSize={9} fill="#64748b">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function NayaxaMultiLineChart({ series, unit, colors, width }: { series: ChartSeries[], unit: string, colors: string[], width: number }) {
  const PAD = { top: 60, right: 30, bottom: 60, left: 40 };
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = 180;
  
  const allValues = series.flatMap(s => s.data.map(d => d.value));
  const maxValue = Math.max(...allValues, 1);
  
  const SERIES_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#0ea5e9'];

  return (
    <svg width={width} height={innerHeight + PAD.top + PAD.bottom + 40} style={{ display: 'block', overflow: 'visible' }}>
      {series.map((s, si) => {
        const color = SERIES_COLORS[si % SERIES_COLORS.length];
        const points = s.data.map((d, i) => ({
          x: PAD.left + (i / Math.max(s.data.length - 1, 1)) * innerWidth,
          y: PAD.top + innerHeight - (d.value / maxValue) * innerHeight
        }));
        const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
        return (
          <g key={si}>
            <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />)}
            <g transform={`translate(${10 + si * 80}, ${innerHeight + PAD.top + PAD.bottom + 10})`}>
              <circle cx={0} cy={0} r={5} fill={color} />
              <text x={10} y={4} fontSize={10} fill="#64748b font-bold">{s.name}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function NayaxaPieChart({ data, colors, width, donut }: { data: ChartDataPoint[], colors: string[], width: number, donut?: boolean }) {
  const cx = width / 2;
  const r = 80;
  const total = data.reduce((s, d) => s + d.value, 0);
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const slice = (d.value / total) * 2 * Math.PI;
    const startAngle = angle;
    angle += slice;
    const x1 = cx + r * Math.cos(startAngle), y1 = r + 40 + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(angle), y2 = r + 40 + r * Math.sin(angle);
    const lx = cx + (r + 20) * Math.cos(startAngle + slice / 2);
    const ly = r + 40 + (r + 20) * Math.sin(startAngle + slice / 2);
    const large = slice > Math.PI ? 1 : 0;
    const path = `M${cx},${r + 40} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`;
    return { path, color: colors[i % colors.length], pct: Math.round((d.value / total) * 100), lx, ly, label: d.label };
  });

  return (
    <svg width={width} height={r * 2 + 150} style={{ display: 'block', overflow: 'visible' }}>
      {slices.map((s, i) => (
        <g key={i}>
          <path d={s.path} fill={s.color} />
          <text x={s.lx} y={s.ly} textAnchor="middle" fontSize={10} fontWeight="bold" fill={s.color}>{s.pct}%</text>
        </g>
      ))}
      {donut && <circle cx={cx} cy={r + 40} r={r * 0.5} fill="white" />}
      {slices.map((s, i) => (
        <g key={i} transform={`translate(10, ${r * 2 + 80 + i * 18})`}>
          <rect width={10} height={10} fill={s.color} rx={2} />
          <text x={15} y={9} fontSize={10} fill="#64748b">{s.label} ({s.pct}%)</text>
        </g>
      ))}
    </svg>
  );
}

export default function NayaxaChart({ spec }: { spec: ChartSpec }) {
  const chartRef = useRef<HTMLDivElement>(null);
  
  const hasSingleSeries = spec?.data && Array.isArray(spec.data) && spec.data.length > 0;
  const hasMultiSeries  = spec?.series && Array.isArray(spec.series) && spec.series.length > 0;
  if (!spec || (!hasSingleSeries && !hasMultiSeries)) return null;

  const colors = COLOR_PALETTES[spec.color || 'indigo'] || COLOR_PALETTES.indigo;
  const unit = spec.unit ? ` ${spec.unit}` : '';
  const width = 360;

  const handleDownloadPng = async () => {
    if (!chartRef.current) return;
    const dataUrl = await toPng(chartRef.current, { backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${spec.title}.png`;
    a.click();
  };

  const handleDownloadExcel = () => {
    const ws = XLSX.utils.json_to_sheet(spec.data || []);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${spec.title}.xlsx`);
  };

  const renderChart = () => {
    if (spec.series && spec.series.length > 0) {
      return <NayaxaMultiLineChart series={spec.series} unit={unit} colors={colors} width={width} />;
    }
    const data = spec.data || [];
    switch (spec.type) {
      case 'column': return <NayaxaColumnChart data={data} unit={unit} colors={colors} width={width} />;
      case 'line':   return <NayaxaLineChart   data={data} unit={unit} colors={colors} width={width} />;
      case 'pie':    return <NayaxaPieChart    data={data} colors={colors} width={width} />;
      case 'donut':  return <NayaxaPieChart    data={data} colors={colors} width={width} donut />;
      default:       return <NayaxaBarChart    data={data} unit={unit} colors={colors} width={width} />;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden my-3 shadow-md max-w-[380px]">
      <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <h4 className="text-[11px] font-bold text-slate-700 truncate">{spec.title}</h4>
        <div className="flex gap-1">
           <button onClick={handleDownloadPng} className="p-1 hover:bg-white rounded transition-colors text-slate-400 hover:text-indigo-600" title="PNG"><Download size={14}/></button>
           <button onClick={handleDownloadExcel} className="p-1 hover:bg-white rounded transition-colors text-slate-400 hover:text-emerald-600" title="Excel"><FileSpreadsheet size={14}/></button>
        </div>
      </div>
      <div ref={chartRef} className="p-4 flex justify-center overflow-visible">
        {renderChart()}
      </div>
    </div>
  );
}

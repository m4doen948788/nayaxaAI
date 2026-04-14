import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid with a professional theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#6366f1', // Indigo 500
    primaryTextColor: '#ffffff',
    primaryBorderColor: '#4f46e5',
    lineColor: '#64748b', // Slate 500
    secondaryColor: '#f1f5f9', // Slate 100
    tertiaryColor: '#ffffff',
  },
  securityLevel: 'loose',
  fontFamily: 'Inter, system-ui, sans-serif',
});

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartId = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    const renderChart = async () => {
      if (!chart) return;
      try {
        setError(null);
        // Clean the chart string (remove surrounding code blocks if provided)
        const cleanChart = chart.replace(/^```mermaid\n?/, '').replace(/\n?```$/, '').trim();
        
        const { svg } = await mermaid.render(chartId.current, cleanChart);
        setSvg(svg);
      } catch (err: any) {
        console.error('Mermaid Render Error:', err);
        setError('Gagal memproses diagram. Pastikan sintaks Mermaid benar.');
        // Clean up internal mermaid state if error occurs
        const el = document.getElementById(chartId.current);
        if (el) el.remove();
      }
    };

    renderChart();
  }, [chart]);

  if (error) {
    return (
      <div className="p-3 my-2 text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg italic">
        {error}
      </div>
    );
  }

  return (
    <div 
      className="mermaid-container my-4 p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default Mermaid;

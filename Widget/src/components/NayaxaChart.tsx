import React, { useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { motion } from 'motion/react';
import { Download, FileSpreadsheet, PieChart as PieChartIcon, BarChart as BarChartIcon } from 'lucide-react';
import { toPng } from 'html-to-image';

interface ChartProps {
  type: 'pie' | 'bar' | 'table';
  data: any[];
  title: string;
}

const NayaxaChart: React.FC<ChartProps> = ({ type, data, title }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const downloadExcel = () => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Nayaxa Analysis");
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_Nayaxa.xlsx`);
  };

  const downloadImage = async () => {
    if (containerRef.current === null) return;
    try {
      const dataUrl = await toPng(containerRef.current, { cacheBust: true });
      const link = document.createElement('a');
      link.download = `${title.replace(/\s+/g, '_')}_Nayaxa.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Image export failed:', err);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-6 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group"
    >
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            {type === 'pie' && <PieChartIcon size={14} className="text-indigo-500" />}
            {type === 'bar' && <BarChartIcon size={14} className="text-violet-500" />}
            {type === 'table' && <FileSpreadsheet size={14} className="text-emerald-500" />}
            {title}
        </h4>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={downloadExcel} title="Export to Excel" className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-emerald-600 transition-all">
                <FileSpreadsheet size={14} />
            </button>
            <button onClick={downloadImage} title="Save as Image" className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-indigo-600 transition-all">
                <Download size={14} />
            </button>
        </div>
      </div>
      
      <div ref={containerRef} className="p-6 bg-white">
        {type === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  {data.length > 0 && Object.keys(data[0]).map((key, i) => (
                    <th key={i} className="px-4 py-3 font-black text-slate-500 uppercase tracking-tighter border-b border-slate-100">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="hover:bg-indigo-50/30 transition-colors">
                    {Object.values(row).map((val: any, j) => (
                      <td key={j} className="px-4 py-3 text-slate-700 border-b border-slate-50 font-medium">
                        {typeof val === 'number' ? val.toLocaleString() : String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-100">
             <div className="text-indigo-300 mb-2">
                {type === 'pie' ? <PieChartIcon size={40} /> : <BarChartIcon size={40} />}
             </div>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center px-8">
                Visualisasi Grafik "{type.toUpperCase()}" sedang diproses untuk data {data.length} baris...
             </p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default NayaxaChart;

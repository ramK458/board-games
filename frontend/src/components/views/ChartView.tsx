import { useRef, useEffect, useState, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { chartApi } from '../../api/client';
import type { ChartData } from '../../types';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler,
);

interface Props { nodeId: number }

// ── Common chart options ──

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const },
  },
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' } },
  },
};

// ── Burndown Chart ──

function BurndownChart({ scope }: { scope: number }) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<ChartJS<'line'>>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    chartApi.burndown(scope)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const handleDownload = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image();
    const a = document.createElement('a');
    a.href = url;
    a.download = 'burndown-chart.png';
    a.click();
  }, []);

  if (loading) return <Skeleton />;
  if (!data) return <EmptyState message="Burndown data unavailable" />;

  return (
    <ChartCard title="Burndown" onDownload={handleDownload}>
      <Line
        ref={chartRef}
        data={{
          labels: data.labels,
          datasets: data.datasets.map((ds, i) => ({
            ...ds,
            fill: false,
            borderColor: i === 0 ? '#ef4444' : '#3b82f6',
            backgroundColor: i === 0 ? '#ef4444' : '#3b82f6',
            borderDash: i === 0 ? [6, 3] : [],
            pointRadius: 2,
            tension: 0.1,
          })),
        }}
        options={{
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          },
        }}
      />
    </ChartCard>
  );
}

// ── Velocity Chart ──

function VelocityChart({ scope }: { scope: number }) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<ChartJS<'bar'>>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    chartApi.velocity(scope, 12)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const handleDownload = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image();
    const a = document.createElement('a');
    a.href = url;
    a.download = 'velocity-chart.png';
    a.click();
  }, []);

  if (loading) return <Skeleton />;
  if (!data) return <EmptyState message="Velocity data unavailable" />;

  return (
    <ChartCard title="Velocity" onDownload={handleDownload}>
      <Bar
        ref={chartRef}
        data={{
          labels: data.labels,
          datasets: data.datasets.map((ds, i) => ({
            ...ds,
            backgroundColor: i === 0 ? 'rgba(59, 130, 246, 0.7)' : 'rgba(34, 197, 94, 0.7)',
            borderColor: i === 0 ? '#3b82f6' : '#22c55e',
            borderWidth: 1,
            borderRadius: 4,
          })),
        }}
        options={{
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          },
          scales: {
            ...chartOptions.scales,
            y: { ...chartOptions.scales.y, title: { display: true, text: 'Tasks completed' } },
          },
        }}
      />
    </ChartCard>
  );
}

// ── Cumulative Flow Chart ──

function CumulativeFlowChart({ scope }: { scope: number }) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<ChartJS<'line'>>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    chartApi.cumulativeFlow(scope)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const handleDownload = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image();
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cumulative-flow-chart.png';
    a.click();
  }, []);

  if (loading) return <Skeleton />;
  if (!data) return <EmptyState message="Cumulative flow data unavailable" />;

  // Colors for stages
  const stageColors = [
    'rgba(156, 163, 175, 0.6)',   // gray
    'rgba(59, 130, 246, 0.6)',    // blue
    'rgba(168, 85, 247, 0.6)',    // purple
    'rgba(245, 158, 11, 0.6)',    // amber
    'rgba(34, 197, 94, 0.6)',     // green
    'rgba(239, 68, 68, 0.6)',     // red
    'rgba(14, 165, 233, 0.6)',    // sky
    'rgba(236, 72, 153, 0.6)',    // pink
  ];

  return (
    <ChartCard title="Cumulative Flow" onDownload={handleDownload}>
      <Line
        ref={chartRef}
        data={{
          labels: data.labels,
          datasets: data.datasets.map((ds, i) => ({
            ...ds,
            fill: true,
            backgroundColor: stageColors[i % stageColors.length],
            borderColor: stageColors[i % stageColors.length].replace('0.6', '1'),
            borderWidth: 1,
            pointRadius: 1,
            tension: 0.3,
          })),
        }}
        options={{
          ...chartOptions,
          plugins: {
            ...chartOptions.plugins,
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          },
          scales: {
            ...chartOptions.scales,
            y: { ...chartOptions.scales.y, title: { display: true, text: 'Task count' } },
          },
        }}
      />
    </ChartCard>
  );
}

// ── Shared helpers ──

function Skeleton() {
  return (
    <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse flex items-center justify-center">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-64 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center text-gray-400">
      <div className="text-center">
        <div className="text-2xl mb-1">📊</div>
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, onDownload, children }: { title: string; onDownload: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <button
          onClick={onDownload}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded"
        >
          Download PNG
        </button>
      </div>
      <div className="h-64">
        {children}
      </div>
    </div>
  );
}

// ── Main export ──

export default function ChartView({ nodeId }: Props) {
  return (
    <div className="h-full space-y-4 overflow-y-auto">
      <BurndownChart scope={nodeId} />
      <VelocityChart scope={nodeId} />
      <CumulativeFlowChart scope={nodeId} />
    </div>
  );
}

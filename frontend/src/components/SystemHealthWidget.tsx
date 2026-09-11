// frontend/src/components/SystemHealthWidget.tsx
import { useEffect, useState } from "react";
import { fetchSystemMetrics } from "../lib/api";

export function SystemHealthWidget() {
  const [metrics, setMetrics] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const data = await fetchSystemMetrics();
        setMetrics(data);
        setError(false);
      } catch (err) {
        setError(true);
      }
    };

    loadMetrics();
    const interval = setInterval(loadMetrics, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  if (error) return <div className="text-red-500 text-xs">Telemetry Offline</div>;
  if (!metrics) return <div className="text-gray-400 text-xs">Loading telemetry...</div>;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-white text-sm shadow-lg">
      <div className="flex justify-between items-center mb-3">
        <span className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          System Observability
        </span>
        <span className="text-xs text-gray-400">Uptime: {Math.floor(metrics.uptime_seconds / 60)}m</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
        <div className="bg-gray-800 p-2 rounded">
          <div>Frames Processed</div>
          <div className="text-lg font-bold text-cyan-400">{metrics.anpr.frames_processed}</div>
        </div>
        <div className="bg-gray-800 p-2 rounded">
          <div>OCR Success Rate</div>
          <div className="text-lg font-bold text-green-400">{metrics.anpr.ocr_success_rate}%</div>
        </div>
        <div className="bg-gray-800 p-2 rounded">
          <div>Active Cameras (30s)</div>
          <div className="text-lg font-bold text-yellow-400">{metrics.cameras.active_now} / {metrics.cameras.registered}</div>
        </div>
        <div className="bg-gray-800 p-2 rounded">
          <div>Events Persisted</div>
          <div className="text-lg font-bold text-purple-400">{metrics.anpr.events_persisted}</div>
        </div>
      </div>
      
      <div className="mt-3 pt-2 border-t border-gray-800 flex justify-between text-[10px] text-gray-400">
        <span>YOLO: {metrics.latency.detection_ms}ms</span>
        <span>OCR: {metrics.latency.ocr_ms}ms</span>
        <span>Pipeline: {metrics.latency.pipeline_ms}ms</span>
      </div>
    </div>
  );
}
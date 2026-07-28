import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useNotificationStore } from '../../stores/notificationStore';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'border-l-green-500 bg-green-50 dark:bg-green-900/30',
  error: 'border-l-red-500 bg-red-50 dark:bg-red-900/30',
  warning: 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-900/30',
  info: 'border-l-blue-500 bg-blue-50 dark:bg-blue-900/30',
};

const iconColorMap = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
  info: 'text-blue-600 dark:text-blue-400',
};

export default function Toast() {
  const toasts = useNotificationStore(s => s.toasts);
  const removeToast = useNotificationStore(s => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2 px-3 py-2.5 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 border-l-4 ${colorMap[toast.type]} animate-slide-up`}
            style={{ animation: 'slideUp 0.2s ease-out' }}
          >
            <Icon size={16} className={`shrink-0 mt-0.5 ${iconColorMap[toast.type]}`} />
            <p className="text-sm flex-1">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-0.5 hover:bg-black/5 dark:hover:bg-white/5 rounded"
            >
              <X size={14} className="text-gray-400" />
            </button>
          </div>
        );
      })}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * DashboardStyles - Enhanced CSS for Phase 2 Dashboard Features
 * 
 * Advanced styling for interactive charts, real-time updates,
 * and enhanced user interface components
 */

export const dashboardStyles = `
/* Phase 2 Dashboard Enhanced Styles */

/* Chart containers with improved responsiveness */
.chart-container {
  position: relative;
  height: 300px;
  margin-bottom: 2rem;
  background: var(--card-bg);
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
}

.chart-container:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-xl);
}

.chart-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
  text-align: center;
}

.chart-wrapper {
  position: relative;
  height: 250px;
  width: 100%;
}

/* Interactive dashboard controls */
.dashboard-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--card-bg);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.control-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.control-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.875rem;
  transition: all 0.3s ease;
}

.control-input:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.control-button {
  padding: 0.5rem 1rem;
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.control-button:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
}

.control-button:active {
  transform: translateY(0);
}

.control-button:disabled {
  background: var(--border-color);
  cursor: not-allowed;
  transform: none;
}

/* Real-time connection status indicator */
.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.3s ease;
}

.connection-status::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.connection-status.connected {
  background: rgba(34, 197, 94, 0.1);
  color: #16a34a;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.connection-status.connected::before {
  background: #16a34a;
}

.connection-status.disconnected {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.connection-status.disconnected::before {
  background: #dc2626;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Enhanced notifications system */
.notifications-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 400px;
}

.notification {
  padding: 1rem 1.5rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  transform: translateX(100%);
  animation: slideIn 0.3s ease forwards;
  border-left: 4px solid;
  position: relative;
}

.notification::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 8px 8px 0 0;
  animation: notificationProgress 5s linear forwards;
}

.notification-info {
  background: rgba(59, 130, 246, 0.1);
  color: #1d4ed8;
  border-left-color: #3b82f6;
}

.notification-info::after {
  background: #3b82f6;
}

.notification-success {
  background: rgba(34, 197, 94, 0.1);
  color: #15803d;
  border-left-color: #22c55e;
}

.notification-success::after {
  background: #22c55e;
}

.notification-warning {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
  border-left-color: #f59e0b;
}

.notification-warning::after {
  background: #f59e0b;
}

.notification-error {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border-left-color: #ef4444;
}

.notification-error::after {
  background: #ef4444;
}

@keyframes slideIn {
  to { transform: translateX(0); }
}

@keyframes notificationProgress {
  from { width: 100%; }
  to { width: 0; }
}

/* Enhanced tools table with filtering */
.tools-section {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid var(--border-color);
  margin-bottom: 2rem;
}

.tools-header {
  display: flex;
  justify-content: between;
  align-items: center;
  margin-bottom: 1.5rem;
  gap: 1rem;
}

.tools-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.tools-filter {
  flex: 1;
  max-width: 300px;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.tools-filter::placeholder {
  color: var(--text-muted);
}

.tools-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.tools-table th {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 600;
  padding: 0.75rem;
  text-align: left;
  border-bottom: 2px solid var(--border-color);
}

.tools-table td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.tools-table tr:hover {
  background: var(--bg-secondary);
}

.tool-name {
  font-weight: 500;
  color: var(--accent-color);
}

.tool-calls,
.tool-success {
  color: var(--success-color);
  font-weight: 500;
}

.tool-errors {
  color: var(--error-color);
  font-weight: 500;
}

.tool-response-time {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
}

.tool-last-called {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

/* Performance metrics with enhanced styling */
.performance-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.metric-item {
  background: var(--card-bg);
  border-radius: 8px;
  padding: 1.5rem;
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
}

.metric-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 8px 8px 0 0;
  background: var(--border-color);
  transition: all 0.3s ease;
}

.metric-item.metric-success::before {
  background: var(--success-color);
}

.metric-item.metric-warning::before {
  background: var(--warning-color);
}

.metric-item.metric-danger::before {
  background: var(--error-color);
}

.metric-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
}

/* Enhanced grid layout for charts */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 2rem;
  margin-bottom: 2rem;
}

.charts-grid .chart-container {
  height: 350px;
}

/* Responsive design improvements */
@media (max-width: 768px) {
  .dashboard-controls {
    flex-direction: column;
  }
  
  .charts-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .charts-grid .chart-container {
    height: 300px;
    padding: 1rem;
  }
  
  .tools-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .tools-filter {
    max-width: none;
  }
  
  .performance-metrics {
    grid-template-columns: 1fr;
  }
  
  .notifications-container {
    left: 1rem;
    right: 1rem;
    max-width: none;
  }
}

@media (max-width: 480px) {
  .chart-container {
    padding: 1rem;
  }
  
  .chart-wrapper {
    height: 200px;
  }
  
  .tools-table {
    font-size: 0.8rem;
  }
  
  .tools-table th,
  .tools-table td {
    padding: 0.5rem;
  }
}

/* Loading states for charts */
.chart-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 250px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.chart-loading::before {
  content: '';
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-radius: 50%;
  border-top-color: var(--accent-color);
  animation: spin 1s ease-in-out infinite;
  margin-right: 0.5rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Enhanced accessibility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Focus management for keyboard navigation */
.dashboard-controls button:focus,
.tools-filter:focus,
.control-input:focus {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

/* Print styles */
@media print {
  .notifications-container,
  .dashboard-controls {
    display: none;
  }
  
  .chart-container {
    break-inside: avoid;
    box-shadow: none;
    border: 1px solid #000;
  }
  
  .tools-table {
    break-inside: auto;
  }
  
  .tools-table thead {
    display: table-header-group;
  }
}

/* Dark theme specific enhancements */
@media (prefers-color-scheme: dark) {
  .chart-container {
    background: #1f2937;
    border-color: #374151;
  }
  
  .notification {
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  }
  
  .tools-table th {
    background: #374151;
  }
  
  .tools-table tr:hover {
    background: #374151;
  }
}
`;

export default dashboardStyles;

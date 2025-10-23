import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Calendar, Download, AlertTriangle, CheckCircle, Settings, BarChart3, FileText, Plus, Edit2, Trash2, Save, X, Filter } from 'lucide-react';

const MedicalLabQADashboard = () => {
    // State Management
    const [currentTab, setCurrentTab] = useState('dataEntry');
    const [selectedBranch, setSelectedBranch] = useState('branch1');
    const [selectedParameter, setSelectedParameter] = useState('glucose');
    const [selectedLevel, setSelectedLevel] = useState('L1');
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });

    // Data States
    interface QcEntry {
        id: string | number;
        date: string;
        parameter: string;
        branch: string;
        level: string;
        value: number;
        enteredBy: string;
        enteredAt: string;
        zScore?: number | null;
    }
    interface TargetValue { mean: number; sd: number; validFrom: string }
    interface AlertItem {
        id: string;
        date: string;
        parameter: string;
        level: string;
        branch: string;
        rule: string;
        severity: 'warning' | 'error';
        description: string;
        acknowledged: boolean;
    }
    const [qcData, setQcData] = useState<QcEntry[]>([]);
    const [targetValues, setTargetValues] = useState<Record<string, TargetValue>>({});
    const [alerts, setAlerts] = useState<AlertItem[]>([]);
    const [parameters, setParameters] = useState([
        { id: 'glucose', name: 'Glucose', unit: 'mg/dL' },
        { id: 'hba1c', name: 'HbA1c', unit: '%' },
        { id: 'cholesterol', name: 'Total Cholesterol', unit: 'mg/dL' },
        { id: 'triglycerides', name: 'Triglycerides', unit: 'mg/dL' }
    ]);
    const [branches] = useState([
        { id: 'branch1', name: 'Main Laboratory' },
        { id: 'branch2', name: 'Branch Lab - North' },
        { id: 'branch3', name: 'Branch Lab - South' }
    ]);

    // Form States
    const [entryForm, setEntryForm] = useState({
        date: new Date().toISOString().split('T')[0],
        parameter: 'glucose',
        branch: 'branch1',
        l1: '',
        l2: '',
        l3: ''
    });

    const [targetForm, setTargetForm] = useState({
        parameter: 'glucose',
        level: 'L1',
        branch: 'branch1',
        mean: '',
        sd: '',
        validFrom: new Date().toISOString().split('T')[0]
    });

    const [showTargetModal, setShowTargetModal] = useState(false);
    const [editingTarget, setEditingTarget] = useState<string | null>(null);

    // Initialize sample data and default target values
    useEffect(() => {
        const defaultTargets: Record<string, TargetValue> = {};
        branches.forEach(branch => {
            parameters.forEach(param => {
                ['L1', 'L2', 'L3'].forEach(level => {
                    const key = `${branch.id}_${param.id}_${level}`;
                    defaultTargets[key] = {
                        mean: param.id === 'glucose' ? (level === 'L1' ? 80 : level === 'L2' ? 150 : 300) :
                            param.id === 'hba1c' ? (level === 'L1' ? 5.0 : level === 'L2' ? 7.5 : 10.0) :
                                param.id === 'cholesterol' ? (level === 'L1' ? 150 : level === 'L2' ? 200 : 300) :
                                    (level === 'L1' ? 100 : level === 'L2' ? 200 : 400),
                        sd: param.id === 'glucose' ? (level === 'L1' ? 4 : level === 'L2' ? 7 : 15) :
                            param.id === 'hba1c' ? (level === 'L1' ? 0.3 : level === 'L2' ? 0.4 : 0.5) :
                                param.id === 'cholesterol' ? (level === 'L1' ? 8 : level === 'L2' ? 10 : 15) :
                                    (level === 'L1' ? 5 : level === 'L2' ? 10 : 20),
                        validFrom: new Date().toISOString().split('T')[0]
                    };
                });
            });
        });
        setTargetValues(defaultTargets);

        // Generate sample data with various scenarios to trigger alerts
        const sampleData = [];
        const today = new Date();

        for (let i = 20; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            // Glucose data with various alert scenarios
            sampleData.push({
                id: `glucose_l1_${i}`,
                date: dateStr,
                parameter: 'glucose',
                branch: 'branch1',
                level: 'L1',
                value: i === 15 ? 92.5 : // 1₃s violation (Z > 3)
                    i === 14 ? 88.8 : // 2₂s violation (consecutive +2SD)
                        i === 13 ? 88.5 : // Part of 2₂s
                            i === 10 ? 72.0 : // Start of 4₁s violation
                                i === 9 ? 71.8 :  // Continue 4₁s
                                    i === 8 ? 72.2 :  // Continue 4₁s  
                                        i === 7 ? 71.5 :  // Complete 4₁s
                                            i < 7 ? 79.5 + (Math.random() - 0.5) * 2 : // Normal with small variation
                                                80 + (Math.random() - 0.5) * 6,
                enteredBy: 'System Sample',
                enteredAt: new Date().toISOString()
            });

            sampleData.push({
                id: `glucose_l2_${i}`,
                date: dateStr,
                parameter: 'glucose',
                branch: 'branch1',
                level: 'L2',
                value: i === 18 ? 180.5 : // R₄s violation setup
                    i === 17 ? 152.0 : // Large range difference  
                        i === 12 ? 165.8 : // 1₂s warning
                            150 + (Math.random() - 0.5) * 10,
                enteredBy: 'System Sample',
                enteredAt: new Date().toISOString()
            });

            // HbA1c data with 10ₓ rule violation
            sampleData.push({
                id: `hba1c_l1_${i}`,
                date: dateStr,
                parameter: 'hba1c',
                branch: 'branch1',
                level: 'L1',
                value: i >= 10 ? 5.15 + Math.random() * 0.1 : // 10 consecutive above mean (10ₓ)
                    5.0 + (Math.random() - 0.5) * 0.4,
                enteredBy: 'System Sample',
                enteredAt: new Date().toISOString()
            });

            // Cholesterol data for Branch 2
            sampleData.push({
                id: `chol_l1_b2_${i}`,
                date: dateStr,
                parameter: 'cholesterol',
                branch: 'branch2',
                level: 'L1',
                value: i === 5 ? 175.2 : // 1₂s warning
                    150 + (Math.random() - 0.5) * 12,
                enteredBy: 'System Sample',
                enteredAt: new Date().toISOString()
            });

            // Triglycerides data
            sampleData.push({
                id: `trig_l3_${i}`,
                date: dateStr,
                parameter: 'triglycerides',
                branch: 'branch1',
                level: 'L3',
                value: i === 16 ? 465.0 : // 1₃s violation
                    400 + (Math.random() - 0.5) * 30,
                enteredBy: 'System Sample',
                enteredAt: new Date().toISOString()
            });
        }

        setQcData(sampleData);
    }, []);

    // Calculate Z-scores and evaluate Westgard rules
    const calculateZScore = (value: number, parameter: string, level: string, branch: string): number | null => {
        const key = `${branch}_${parameter}_${level}`;
        const target = targetValues[key];
        if (!target || !target.mean || !target.sd) return null;
        return (value - target.mean) / target.sd;
    };

    const evaluateWestgardRules = (data: QcEntry[]) => {
        const newAlerts: AlertItem[] = [];

        // Sort data by date for consecutive rule evaluation
        const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        sortedData.forEach((entry, index) => {
            const zScore = entry.zScore;
            if (zScore === null || zScore === undefined) return;

            // 1₃s rule - single result exceeds ±3SD
            if (Math.abs(zScore) > 3) {
                newAlerts.push({
                    id: `${entry.id}_1_3s`,
                    date: entry.date,
                    parameter: entry.parameter,
                    level: entry.level,
                    branch: entry.branch,
                    rule: '1₃s',
                    severity: 'error',
                    description: `Single result exceeds ±3SD (Z=${zScore.toFixed(2)})`,
                    acknowledged: false
                });
            }

            // 1₂s rule - single result exceeds ±2SD (warning)
            else if (Math.abs(zScore) > 2) {
                newAlerts.push({
                    id: `${entry.id}_1_2s`,
                    date: entry.date,
                    parameter: entry.parameter,
                    level: entry.level,
                    branch: entry.branch,
                    rule: '1₂s',
                    severity: 'warning',
                    description: `Single result exceeds ±2SD (Z=${zScore.toFixed(2)})`,
                    acknowledged: false
                });
            }

            // Check consecutive rules (need previous entries)
            if (index > 0) {
                const prevEntry = sortedData[index - 1];
                if (prevEntry.parameter === entry.parameter &&
                    prevEntry.level === entry.level &&
                    prevEntry.branch === entry.branch &&
                    prevEntry.zScore !== null) {

                    // 2₂s rule - two consecutive results exceed ±2SD on same side
                    if (
                        prevEntry.zScore !== null && prevEntry.zScore !== undefined &&
                        Math.abs(zScore) > 2 && Math.abs(prevEntry.zScore) > 2 &&
                        Math.sign(zScore) === Math.sign(prevEntry.zScore)
                    ) {
                        newAlerts.push({
                            id: `${entry.id}_2_2s`,
                            date: entry.date,
                            parameter: entry.parameter,
                            level: entry.level,
                            branch: entry.branch,
                            rule: '2₂s',
                            severity: 'error',
                            description: `Two consecutive results exceed ±2SD on same side`,
                            acknowledged: false
                        });
                    }

                    // R₄s rule - range of consecutive results exceeds 4SD
                    if (prevEntry.zScore !== null && prevEntry.zScore !== undefined && Math.abs(zScore - prevEntry.zScore) >= 4) {
                        newAlerts.push({
                            id: `${entry.id}_R_4s`,
                            date: entry.date,
                            parameter: entry.parameter,
                            level: entry.level,
                            branch: entry.branch,
                            rule: 'R₄s',
                            severity: 'error',
                            description: `Range between consecutive results ≥4SD`,
                            acknowledged: false
                        });
                    }
                }
            }

            // 4₁s rule - four consecutive results exceed ±1SD on same side
            if (index >= 3) {
                const recent4 = sortedData.slice(index - 3, index + 1);
                if (recent4.every(r => r.parameter === entry.parameter &&
                    r.level === entry.level &&
                    r.branch === entry.branch &&
                    r.zScore !== null && r.zScore !== undefined &&
                    Math.abs(r.zScore) > 1 &&
                    Math.sign(r.zScore) === Math.sign(zScore))) {
                    newAlerts.push({
                        id: `${entry.id}_4_1s`,
                        date: entry.date,
                        parameter: entry.parameter,
                        level: entry.level,
                        branch: entry.branch,
                        rule: '4₁s',
                        severity: 'error',
                        description: `Four consecutive results exceed ±1SD on same side`,
                        acknowledged: false
                    });
                }
            }

            // 10ₓ rule - ten consecutive results on same side of mean
            if (index >= 9) {
                const recent10 = sortedData.slice(index - 9, index + 1);
                if (recent10.every(r => r.parameter === entry.parameter &&
                    r.level === entry.level &&
                    r.branch === entry.branch &&
                    r.zScore !== null && r.zScore !== undefined &&
                    Math.sign(r.zScore) === Math.sign(zScore))) {
                    newAlerts.push({
                        id: `${entry.id}_10_x`,
                        date: entry.date,
                        parameter: entry.parameter,
                        level: entry.level,
                        branch: entry.branch,
                        rule: '10ₓ',
                        severity: 'error',
                        description: `Ten consecutive results on same side of mean`,
                        acknowledged: false
                    });
                }
            }
        });

        setAlerts(newAlerts);
    };

    // Process QC data to add Z-scores
    const processedQcData: QcEntry[] = useMemo(() => {
        const processed: QcEntry[] = qcData.map(entry => {
            const zScore = calculateZScore(entry.value, entry.parameter, entry.level, entry.branch);
            return { ...entry, zScore };
        });
        evaluateWestgardRules(processed);
        return processed;
    }, [qcData, targetValues]);

    // Filter data based on current selections
    const filteredData = useMemo(() => {
        return processedQcData.filter(entry => {
            const entryDate = new Date(entry.date);
            const startDate = new Date(dateRange.start);
            const endDate = new Date(dateRange.end);

            return entry.branch === selectedBranch &&
                entry.parameter === selectedParameter &&
                entryDate >= startDate &&
                entryDate <= endDate;
        });
    }, [processedQcData, selectedBranch, selectedParameter, dateRange]);

    // Calculate observed statistics
    const observedStats = useMemo(() => {
        const stats: Record<string, { n: number; mean: string; sd: string }> = {};
        ['L1', 'L2', 'L3'].forEach(level => {
            const levelData = filteredData.filter(d => d.level === level);
            if (levelData.length > 0) {
                const values = levelData.map(d => d.value);
                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
                const sd = Math.sqrt(variance);

                stats[level] = {
                    n: values.length,
                    mean: mean.toFixed(2),
                    sd: sd.toFixed(2)
                };
            }
        });
        return stats;
    }, [filteredData]);

    // Form handlers
    const handleEntrySubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const entries: QcEntry[] = [];

        (['l1', 'l2', 'l3'] as const).forEach(level => {
            const valueStr = (entryForm as Record<string, string>)[level];
            if (valueStr) {
                const entry = {
                    id: Date.now() + Math.random(),
                    date: entryForm.date,
                    parameter: entryForm.parameter,
                    branch: entryForm.branch,
                    level: level.toUpperCase(),
                    value: parseFloat(valueStr),
                    enteredBy: 'Current User',
                    enteredAt: new Date().toISOString()
                };
                entries.push(entry);
            }
        });

        setQcData(prev => [...prev, ...entries]);
        setEntryForm({
            ...entryForm,
            l1: '',
            l2: '',
            l3: ''
        });
    };

    const handleTargetSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const key = `${targetForm.branch}_${targetForm.parameter}_${targetForm.level}`;
        setTargetValues(prev => ({
            ...prev,
            [key]: {
                mean: parseFloat(targetForm.mean),
                sd: parseFloat(targetForm.sd),
                validFrom: targetForm.validFrom
            }
        }));
        setShowTargetModal(false);
        setTargetForm({
            parameter: 'glucose',
            level: 'L1',
            branch: 'branch1',
            mean: '',
            sd: '',
            validFrom: new Date().toISOString().split('T')[0]
        });
    };

    const acknowledgeAlert = (alertId: string) => {
        setAlerts(prev => prev.map(alert =>
            alert.id === alertId ? { ...alert, acknowledged: true } : alert
        ));
    };

    // Chart data preparation
    const chartData = useMemo(() => {
        const data: Record<string, { date: string; zScore?: number | null; value: number; hasAlert: boolean }[]> = {};
        ['L1', 'L2', 'L3'].forEach(level => {
            data[level] = filteredData
                .filter(d => d.level === level)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(d => ({
                    date: d.date,
                    zScore: d.zScore,
                    value: d.value,
                    hasAlert: alerts.some(alert =>
                        alert.date === d.date &&
                        alert.level === d.level &&
                        alert.parameter === d.parameter &&
                        alert.branch === d.branch
                    )
                }));
        });
        return data;
    }, [filteredData, alerts]);

    const renderDataEntry = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Plus className="w-5 h-5" />
                    QC Data Entry
                </h2>

                <form onSubmit={handleEntrySubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Date</label>
                            <input
                                type="date"
                                value={entryForm.date}
                                onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Branch</label>
                            <select
                                value={entryForm.branch}
                                onChange={(e) => setEntryForm({ ...entryForm, branch: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                            >
                                {branches.map(branch => (
                                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Parameter</label>
                            <select
                                value={entryForm.parameter}
                                onChange={(e) => setEntryForm({ ...entryForm, parameter: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                            >
                                {parameters.map(param => (
                                    <option key={param.id} value={param.id}>{param.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">L1 Value</label>
                            <input
                                type="number"
                                step="0.01"
                                value={entryForm.l1}
                                onChange={(e) => setEntryForm({ ...entryForm, l1: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter L1 value"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">L2 Value</label>
                            <input
                                type="number"
                                step="0.01"
                                value={entryForm.l2}
                                onChange={(e) => setEntryForm({ ...entryForm, l2: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter L2 value"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">L3 Value</label>
                            <input
                                type="number"
                                step="0.01"
                                value={entryForm.l3}
                                onChange={(e) => setEntryForm({ ...entryForm, l3: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter L3 value"
                            />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" />
                            Save Entry
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Recent Entries</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2">Date</th>
                                <th className="text-left py-2">Parameter</th>
                                <th className="text-left py-2">Level</th>
                                <th className="text-left py-2">Value</th>
                                <th className="text-left py-2">Z-Score</th>
                                <th className="text-left py-2">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {processedQcData.slice(-10).reverse().map(entry => (
                                <tr key={entry.id} className="border-b">
                                    <td className="py-2">{entry.date}</td>
                                    <td className="py-2">{parameters.find(p => p.id === entry.parameter)?.name}</td>
                                    <td className="py-2">{entry.level}</td>
                                    <td className="py-2">{entry.value}</td>
                                    <td className="py-2">{entry.zScore?.toFixed(2) || 'N/A'}</td>
                                    <td className="py-2">
                                        {entry.zScore && Math.abs(entry.zScore) > 2 ? (
                                            <span className="text-red-600 flex items-center gap-1">
                                                <AlertTriangle className="w-4 h-4" />
                                                Alert
                                            </span>
                                        ) : (
                                            <span className="text-green-600 flex items-center gap-1">
                                                <CheckCircle className="w-4 h-4" />
                                                Normal
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderCharts = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        Levey-Jennings Charts
                    </h2>

                    <div className="flex gap-2">
                        <select
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                            className="p-2 border rounded"
                        >
                            {branches.map(branch => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>

                        <select
                            value={selectedParameter}
                            onChange={(e) => setSelectedParameter(e.target.value)}
                            className="p-2 border rounded"
                        >
                            {parameters.map(param => (
                                <option key={param.id} value={param.id}>{param.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    {['L1', 'L2', 'L3'].map(level => {
                        const data = chartData[level] || [];
                        if (data.length === 0) return null;

                        return (
                            <div key={level} className="border rounded p-4">
                                <h3 className="text-lg font-medium mb-2">{level} - {parameters.find(p => p.id === selectedParameter)?.name}</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={data}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" />
                                            <YAxis label={{ value: 'Z-Score', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip
                                                formatter={(value) => {
                                                    const num = typeof value === 'number' ? value : parseFloat(String(value));
                                                    return [isNaN(num) ? value : num.toFixed(2), 'Z-Score'];
                                                }}
                                                labelFormatter={(label) => `Date: ${label}`}
                                            />
                                            <ReferenceLine y={0} stroke="#000" strokeDasharray="2 2" />
                                            <ReferenceLine y={1} stroke="#ffa500" strokeDasharray="2 2" />
                                            <ReferenceLine y={-1} stroke="#ffa500" strokeDasharray="2 2" />
                                            <ReferenceLine y={2} stroke="#ff0000" strokeDasharray="2 2" />
                                            <ReferenceLine y={-2} stroke="#ff0000" strokeDasharray="2 2" />
                                            <ReferenceLine y={3} stroke="#8b0000" strokeDasharray="2 2" />
                                            <ReferenceLine y={-3} stroke="#8b0000" strokeDasharray="2 2" />
                                            <Line
                                                type="monotone"
                                                dataKey="zScore"
                                                stroke="#2563eb"
                                                strokeWidth={2}
                                                dot={(props) => {
                                                    const { cx, cy, payload } = props;
                                                    const color = payload.hasAlert ? '#dc2626' : '#2563eb';
                                                    return <circle cx={cx} cy={cy} r={4} fill={color} stroke={color} />;
                                                }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Observed Statistics</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2">Level</th>
                                <th className="text-left py-2">n</th>
                                <th className="text-left py-2">Observed Mean</th>
                                <th className="text-left py-2">Observed SD</th>
                                <th className="text-left py-2">Target Mean</th>
                                <th className="text-left py-2">Target SD</th>
                                <th className="text-left py-2">Bias</th>
                            </tr>
                        </thead>
                        <tbody>
                            {['L1', 'L2', 'L3'].map(level => {
                                const stats = observedStats[level];
                                const targetKey = `${selectedBranch}_${selectedParameter}_${level}`;
                                const target = targetValues[targetKey];

                                if (!stats) return null;

                                const bias = target ? ((parseFloat(stats.mean) - target.mean) / target.mean * 100).toFixed(1) : 'N/A';

                                return (
                                    <tr key={level} className="border-b">
                                        <td className="py-2">{level}</td>
                                        <td className="py-2">{stats.n}</td>
                                        <td className="py-2">{stats.mean}</td>
                                        <td className="py-2">{stats.sd}</td>
                                        <td className="py-2">{target?.mean || 'N/A'}</td>
                                        <td className="py-2">{target?.sd || 'N/A'}</td>
                                        <td className="py-2">{bias}%</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderAlerts = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Westgard Rule Alerts
                </h2>

                <div className="mb-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                        <div className="bg-red-50 p-3 rounded">
                            <div className="font-medium text-red-800">Critical Alerts</div>
                            <div className="text-2xl font-bold text-red-600">
                                {alerts.filter(a => a.severity === 'error' && !a.acknowledged).length}
                            </div>
                        </div>
                        <div className="bg-yellow-50 p-3 rounded">
                            <div className="font-medium text-yellow-800">Warnings</div>
                            <div className="text-2xl font-bold text-yellow-600">
                                {alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length}
                            </div>
                        </div>
                        <div className="bg-green-50 p-3 rounded">
                            <div className="font-medium text-green-800">Acknowledged</div>
                            <div className="text-2xl font-bold text-green-600">
                                {alerts.filter(a => a.acknowledged).length}
                            </div>
                        </div>
                        <div className="bg-blue-50 p-3 rounded">
                            <div className="font-medium text-blue-800">Total Alerts</div>
                            <div className="text-2xl font-bold text-blue-600">
                                {alerts.length}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2">Date</th>
                                <th className="text-left py-2">Branch</th>
                                <th className="text-left py-2">Parameter</th>
                                <th className="text-left py-2">Level</th>
                                <th className="text-left py-2">Rule</th>
                                <th className="text-left py-2">Description</th>
                                <th className="text-left py-2">Severity</th>
                                <th className="text-left py-2">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {alerts.map(alert => (
                                <tr key={alert.id} className={`border-b ${alert.acknowledged ? 'opacity-50' : ''}`}>
                                    <td className="py-2">{alert.date}</td>
                                    <td className="py-2">{branches.find(b => b.id === alert.branch)?.name}</td>
                                    <td className="py-2">{parameters.find(p => p.id === alert.parameter)?.name}</td>
                                    <td className="py-2">{alert.level}</td>
                                    <td className="py-2">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${alert.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {alert.rule}
                                        </span>
                                    </td>
                                    <td className="py-2">{alert.description}</td>
                                    <td className="py-2">
                                        <span className={`px-2 py-1 rounded text-xs ${alert.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {alert.severity}
                                        </span>
                                    </td>
                                    <td className="py-2">
                                        {!alert.acknowledged && (
                                            <button
                                                onClick={() => acknowledgeAlert(alert.id)}
                                                className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"
                                            >
                                                Acknowledge
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Westgard Rules Reference</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-medium">1₂s</span>
                            <span>Warning: Single result exceeds ±2SD</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">1₃s</span>
                            <span>Error: Single result exceeds ±3SD</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">2₂s</span>
                            <span>Error: 2 consecutive results exceed ±2SD (same side)</span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">R₄s</span>
                            <span>Error: Range between consecutive results ≥4SD</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">4₁s</span>
                            <span>Error: 4 consecutive results exceed ±1SD (same side)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">10ₓ</span>
                            <span>Error: 10 consecutive results on same side of mean</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderTargetManagement = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Settings className="w-5 h-5" />
                        Target Mean & SD Management
                    </h2>
                    <button
                        onClick={() => setShowTargetModal(true)}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Add Target
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2">Branch</th>
                                <th className="text-left py-2">Parameter</th>
                                <th className="text-left py-2">Level</th>
                                <th className="text-left py-2">Mean</th>
                                <th className="text-left py-2">SD</th>
                                <th className="text-left py-2">Valid From</th>
                                <th className="text-left py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(targetValues).map(([key, target]) => {
                                const [branchId, parameterId, level] = key.split('_');
                                const branch = branches.find(b => b.id === branchId);
                                const parameter = parameters.find(p => p.id === parameterId);

                                return (
                                    <tr key={key} className="border-b">
                                        <td className="py-2">{branch?.name}</td>
                                        <td className="py-2">{parameter?.name}</td>
                                        <td className="py-2">{level}</td>
                                        <td className="py-2">{target.mean}</td>
                                        <td className="py-2">{target.sd}</td>
                                        <td className="py-2">{target.validFrom}</td>
                                        <td className="py-2">
                                            <button
                                                onClick={() => {
                                                    setEditingTarget(key);
                                                    setTargetForm({
                                                        parameter: parameterId,
                                                        level: level,
                                                        branch: branchId,
                                                        mean: target.mean.toString(),
                                                        sd: target.sd.toString(),
                                                        validFrom: target.validFrom
                                                    });
                                                    setShowTargetModal(true);
                                                }}
                                                className="text-blue-600 hover:text-blue-800 mr-2"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderReports = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Monthly Reports
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium mb-1">Branch</label>
                        <select className="w-full p-2 border rounded">
                            {branches.map(branch => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Month</label>
                        <input
                            type="month"
                            defaultValue={new Date().toISOString().slice(0, 7)}
                            className="w-full p-2 border rounded"
                        />
                    </div>

                    <div className="flex items-end">
                        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            Generate Report
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 p-4 rounded">
                    <h3 className="font-medium mb-2">Report will include:</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                        <li>• Levey-Jennings charts for all parameters and levels</li>
                        <li>• Complete list of Westgard rule violations</li>
                        <li>• Summary statistics (observed vs target mean/SD)</li>
                        <li>• Control performance metrics</li>
                        <li>• Audit trail of target value changes</li>
                    </ul>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Export Data</h3>
                <div className="flex gap-2">
                    <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export as Excel
                    </button>
                    <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export as CSV
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white shadow-sm border-b">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-600 text-white p-2 rounded">
                                <BarChart3 className="w-6 h-6" />
                            </div>
                            <h1 className="text-xl font-semibold text-gray-900">Medical Lab QA Dashboard</h1>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Calendar className="w-4 h-4" />
                                <input
                                    type="date"
                                    value={dateRange.start}
                                    onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                                    className="border rounded px-2 py-1"
                                />
                                <span>to</span>
                                <input
                                    type="date"
                                    value={dateRange.end}
                                    onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                                    className="border rounded px-2 py-1"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="bg-white border-b">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <nav className="flex space-x-8">
                        {[
                            { id: 'dataEntry', name: 'Data Entry', icon: Plus },
                            { id: 'charts', name: 'Charts & Analysis', icon: BarChart3 },
                            { id: 'alerts', name: 'Alerts', icon: AlertTriangle },
                            { id: 'targets', name: 'Target Management', icon: Settings },
                            { id: 'reports', name: 'Reports', icon: FileText }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setCurrentTab(tab.id)}
                                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${currentTab === tab.id
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                            >
                                <tab.icon className="w-4 h-4" />
                                {tab.name}
                                {tab.id === 'alerts' && alerts.filter(a => !a.acknowledged).length > 0 && (
                                    <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[1.5rem] text-center">
                                        {alerts.filter(a => !a.acknowledged).length}
                                    </span>
                                )}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {currentTab === 'dataEntry' && renderDataEntry()}
                {currentTab === 'charts' && renderCharts()}
                {currentTab === 'alerts' && renderAlerts()}
                {currentTab === 'targets' && renderTargetManagement()}
                {currentTab === 'reports' && renderReports()}
            </div>

            {/* Target Management Modal */}
            {showTargetModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold">
                                {editingTarget ? 'Edit Target Values' : 'Add Target Values'}
                            </h3>
                            <button
                                onClick={() => {
                                    setShowTargetModal(false);
                                    setEditingTarget(null);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleTargetSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Branch</label>
                                <select
                                    value={targetForm.branch}
                                    onChange={(e) => setTargetForm({ ...targetForm, branch: e.target.value })}
                                    className="w-full p-2 border rounded"
                                    required
                                >
                                    {branches.map(branch => (
                                        <option key={branch.id} value={branch.id}>{branch.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Parameter</label>
                                <select
                                    value={targetForm.parameter}
                                    onChange={(e) => setTargetForm({ ...targetForm, parameter: e.target.value })}
                                    className="w-full p-2 border rounded"
                                    required
                                >
                                    {parameters.map(param => (
                                        <option key={param.id} value={param.id}>{param.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Level</label>
                                <select
                                    value={targetForm.level}
                                    onChange={(e) => setTargetForm({ ...targetForm, level: e.target.value })}
                                    className="w-full p-2 border rounded"
                                    required
                                >
                                    <option value="L1">L1</option>
                                    <option value="L2">L2</option>
                                    <option value="L3">L3</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Target Mean</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={targetForm.mean}
                                    onChange={(e) => setTargetForm({ ...targetForm, mean: e.target.value })}
                                    className="w-full p-2 border rounded"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Target SD</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={targetForm.sd}
                                    onChange={(e) => setTargetForm({ ...targetForm, sd: e.target.value })}
                                    className="w-full p-2 border rounded"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Valid From</label>
                                <input
                                    type="date"
                                    value={targetForm.validFrom}
                                    onChange={(e) => setTargetForm({ ...targetForm, validFrom: e.target.value })}
                                    className="w-full p-2 border rounded"
                                    required
                                />
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
                                >
                                    {editingTarget ? 'Update' : 'Add'} Target
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowTargetModal(false);
                                        setEditingTarget(null);
                                    }}
                                    className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MedicalLabQADashboard;
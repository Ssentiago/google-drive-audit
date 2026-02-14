import { useCallback, useEffect, useRef } from 'react';
import { alpha, Box, Typography } from '@mui/material';
import { listen } from '@tauri-apps/api/event';

interface TreeNode {
    id: string;
    itemType: 'folder' | 'file';
    parentId: string | null;
}

interface ScanProgress {
    foldersProcessed: number;
    filesProcessed: number;
}

const HISTORY_SECONDS = 60; // сколько секунд истории показываем
const TICK_MS = 250; // интервал тика — 4 раза в секунду
const TICKS_TOTAL = HISTORY_SECONDS * (1000 / TICK_MS); // 240 тиков
const MA_WINDOW = 8; // окно скользящего среднего

// Один тик = { files, folders } за этот интервал
interface Tick {
    files: number;
    folders: number;
}

const ScanPulse = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);

    // Кольцевой буфер тиков
    const ticksRef = useRef<Tick[]>(
        Array.from({ length: TICKS_TOTAL }, () => ({ files: 0, folders: 0 }))
    );
    const currentTickRef = useRef<Tick>({ files: 0, folders: 0 });
    const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Текущая скорость для отображения
    const rateRef = useRef({ filesPerSec: 0, foldersPerSec: 0 });
    const totalRef = useRef({ files: 0, folders: 0 });

    useEffect(() => {
        // Слушаем новые узлы дерева — каждый узел = импульс
        const unlistenTree = listen<TreeNode>('audit_tree_node', (event) => {
            const node = event.payload;
            if (node.itemType === 'folder') {
                currentTickRef.current.folders += 1;
                totalRef.current.folders += 1;
            } else {
                currentTickRef.current.files += 1;
                totalRef.current.files += 1;
            }
        });

        // Тикер: каждые TICK_MS пушим текущий тик в буфер
        tickIntervalRef.current = setInterval(() => {
            const tick = { ...currentTickRef.current };
            currentTickRef.current = { files: 0, folders: 0 };

            ticksRef.current.shift();
            ticksRef.current.push(tick);

            // Считаем скорость за последние 4 тика (1 сек)
            const recentTicks = ticksRef.current.slice(-4);
            const filesPerSec = recentTicks.reduce((s, t) => s + t.files, 0);
            const foldersPerSec = recentTicks.reduce(
                (s, t) => s + t.folders,
                0
            );
            rateRef.current = { filesPerSec, foldersPerSec };
        }, TICK_MS);

        return () => {
            unlistenTree.then((fn) => fn());
            if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        };
    }, []);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;

        const W = rect.width;
        const H = rect.height;

        ctx.clearRect(0, 0, W, H);

        const ticks = ticksRef.current;
        const n = ticks.length;

        // Максимум для нормализации — по всей истории
        const maxVal = Math.max(1, ...ticks.map((t) => t.files + t.folders));

        const barW = W / n;
        // Зона рисования: оставляем отступы
        const padLeft = 6;
        const padRight = 90; // место для текста справа
        const padTop = 8;
        const padBottom = 18; // место для временной оси
        const drawW = W - padLeft - padRight;
        const drawH = H - padTop - padBottom;

        // Фон сетки
        ctx.strokeStyle = alpha('#ffffff', 0.06);
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padTop + (drawH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + drawW, y);
            ctx.stroke();
        }

        // Временные метки снизу
        ctx.fillStyle = alpha('#ffffff', 0.3);
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        const secondsPerTick = TICK_MS / 1000;
        for (let sec = 0; sec <= HISTORY_SECONDS; sec += 10) {
            const tickIdx = n - 1 - Math.round(sec / secondsPerTick);
            if (tickIdx < 0) break;
            const x = padLeft + (tickIdx / (n - 1)) * drawW;
            ctx.fillText(`-${sec}s`, x, H - 4);
        }

        // Скользящее среднее (total)
        const maValues: number[] = [];
        for (let i = 0; i < n; i++) {
            const start = Math.max(0, i - MA_WINDOW + 1);
            const window = ticks.slice(start, i + 1);
            const avg =
                window.reduce((s, t) => s + t.files + t.folders, 0) /
                window.length;
            maValues.push(avg);
        }

        // Столбики — папки (синие) + файлы (серые) стекаются

        // Столбики — папки (синие) + файлы (зелёные) стекаются
        for (let i = 0; i < n; i++) {
            const tick = ticks[i];
            const x = padLeft + (i / (n - 1)) * drawW;
            const total = tick.files + tick.folders;
            if (total === 0) continue;

            const totalH = (total / maxVal) * drawH;
            const foldersH = (tick.folders / maxVal) * drawH;
            const filesH = totalH - foldersH;

            // Файлы (зелёные, снизу)
            if (filesH > 0) {
                const alpha_val = 0.7 + (tick.files / maxVal) * 0.3;
                ctx.fillStyle = `rgba(76, 175, 80, ${alpha_val})`; // #4caf50 зелёный
                ctx.fillRect(
                    x - barW * 0.4,
                    padTop + drawH - filesH,
                    barW * 0.8,
                    filesH
                );
            }

            // Папки (синие, сверху)
            if (foldersH > 0) {
                const alpha_val = 0.75 + (tick.folders / maxVal) * 0.25;
                ctx.fillStyle = `rgba(33, 150, 243, ${alpha_val})`; // #2196f3 синий
                ctx.fillRect(
                    x - barW * 0.4,
                    padTop + drawH - totalH,
                    barW * 0.8,
                    foldersH
                );
            }
        }
        // Скользящее среднее — красная линия поверх
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(244, 67, 54, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';

        let started = false;
        for (let i = 0; i < n; i++) {
            const x = padLeft + (i / (n - 1)) * drawW;
            const y = padTop + drawH - (maValues[i] / maxVal) * drawH;
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Текущий импульс — вертикальная линия на правом крае
        const lastTick = ticks[n - 1];
        const lastTotal = lastTick.files + lastTick.folders;
        if (lastTotal > 0) {
            const x = padLeft + drawW;
            const h = (lastTotal / maxVal) * drawH;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, padTop + drawH);
            ctx.lineTo(x, padTop + drawH - h);
            ctx.stroke();
        }

        // Правая панель: скорость и счётчики
        const rx = padLeft + drawW + 8;

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${rateRef.current.filesPerSec}/с`, rx, padTop + 14);

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px monospace';
        ctx.fillText('файлов', rx, padTop + 25);

        ctx.fillStyle = 'rgba(33, 150, 243, 0.9)';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${rateRef.current.foldersPerSec}/с`, rx, padTop + 42);

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px monospace';
        ctx.fillText('папок', rx, padTop + 53);

        // Разделитель
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx, padTop + 62);
        ctx.lineTo(rx + 75, padTop + 62);
        ctx.stroke();

        // Итого
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '9px monospace';
        ctx.fillText(
            `∑ ${totalRef.current.files + totalRef.current.folders}`,
            rx,
            padTop + 74
        );
    }, []);

    useEffect(() => {
        const animate = () => {
            draw();
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animFrameRef.current = requestAnimationFrame(animate);
        return () => {
            if (animFrameRef.current)
                cancelAnimationFrame(animFrameRef.current);
        };
    }, [draw]);

    return (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {/* Легенда */}
            <Box
                sx={{
                    position: 'absolute',
                    top: 6,
                    left: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    zIndex: 1,
                    pointerEvents: 'none',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '2px',
                            bgcolor: 'rgba(33,150,243,0.8)',
                        }}
                    />
                    <Typography
                        variant='caption'
                        sx={{
                            fontSize: 9,
                            color: alpha('#fff', 0.7),
                            lineHeight: 1,
                        }}
                    >
                        папки
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '2px',
                            bgcolor: 'rgba(76,175,80,0.8)',
                        }}
                    />
                    <Typography
                        variant='caption'
                        sx={{
                            fontSize: 9,
                            color: alpha('#fff', 0.7),
                            lineHeight: 1,
                        }}
                    >
                        файлы
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 16,
                            height: 2,
                            bgcolor: 'rgba(244,67,54,0.85)',
                            borderRadius: '1px',
                        }}
                    />
                    <Typography
                        variant='caption'
                        sx={{
                            fontSize: 9,
                            color: alpha('#fff', 0.7),
                            lineHeight: 1,
                        }}
                    >
                        среднее
                    </Typography>
                </Box>
            </Box>

            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block' }}
            />
        </Box>
    );
};

export default ScanPulse;

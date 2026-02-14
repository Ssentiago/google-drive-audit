import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    alpha,
    Box,
    Button,
    Card,
    Chip,
    IconButton,
    LinearProgress,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    HelpOutline as HelpOutlineIcon,
    PlayArrow as PlayArrowIcon,
    Stop as StopIcon,
} from '@mui/icons-material';
import { useGlobalContext } from '../../../../core/GlobalContext.tsx';
import LogDrawer from '../../../common/LogDrawer.tsx';
import {
    FolderSelector,
    SavedFolder,
} from '../../../common/FolderSelector.tsx';
import { AuditResult, ScanProgress } from '../types/interfaces.ts';
import ScanPulse from './components/ScanPulse.tsx';
import Tree from './components/Tree.tsx';

interface Props {
    onScanComplete: (result: AuditResult) => void;
}

export const AuditScan: React.FC<Props> = ({ onScanComplete }) => {
    const [folderId, setFolderId] = useState('');
    const [scanning, setScanning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);
    const [idError, setIdError] = useState('');
    const [progress, setProgress] = useState<ScanProgress>({
        foldersProcessed: 0,
        filesProcessed: 0,
    });
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [savedFolders, setSavedFolders] = useState<SavedFolder[]>([]);
    const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
    const [estimatedFolders, setEstimatedFolders] = useState<number | null>(
        null
    );
    const [estimatedFiles, setEstimatedFiles] = useState<number | null>(null);
    const [hasPrevData, setHasPrevData] = useState(false);
    const [validating, setValidating] = useState(false);

    const { setCurrentPage } = useGlobalContext();

    useEffect(() => {
        loadSavedFolders();
    }, []);

    useEffect(() => {
        let unlistenProgress: (() => void) | undefined;
        let unlistenLog: (() => void) | undefined;
        let unlistenTree: (() => void) | undefined;

        listen<ScanProgress>('audit_progress', (event) => {
            setProgress(event.payload);
        }).then((fn) => {
            unlistenProgress = fn;
        });

        listen('audit_log', (event) => {
            setLogs((p) => [...p, event.payload as string]);
            if (!drawerOpen) {
                setNewLogsCount((c) => c + 1);
            }
        }).then((fn) => {
            unlistenLog = fn;
        });

        listen<any>('audit_tree_node', (event) => {
            // Tree handling можно добавить если нужно
        }).then((fn) => {
            unlistenTree = fn;
        });

        return () => {
            unlistenProgress?.();
            unlistenLog?.();
            unlistenTree?.();
        };
    }, [drawerOpen]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        if (scanning) {
            setElapsedSeconds(0);
            timer = setInterval(() => {
                setElapsedSeconds((prev) => prev + 1);
            }, 1000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [scanning]);

    useEffect(() => {
        if (scanning) {
            const currentSaved = savedFolders.find((f) => f.id === folderId);

            if (currentSaved?.lastScan) {
                setHasPrevData(true);
                setEstimatedFolders(currentSaved.lastScan.foldersCount);
                setEstimatedFiles(currentSaved.lastScan.filesCount);

                const prevFolder = currentSaved.lastScan;
                const prevTotalItems =
                    prevFolder.foldersCount + prevFolder.filesCount / 10;
                const timePerItem = prevFolder.durationSec / prevTotalItems;

                const currentItems =
                    progress.foldersProcessed + progress.filesProcessed / 10;
                const remainingItems =
                    prevFolder.foldersCount +
                    prevFolder.filesCount / 10 -
                    currentItems;

                let eta = remainingItems * timePerItem;

                let avgTimePerItem = timePerItem;
                let countSimilar = 1;
                (currentSaved.scanHistory || []).forEach((h: any) => {
                    const deltaFolders =
                        Math.abs(h.foldersCount - prevFolder.foldersCount) /
                        prevFolder.foldersCount;
                    const deltaFiles =
                        Math.abs(h.filesCount - prevFolder.filesCount) /
                        prevFolder.filesCount;
                    if (deltaFolders < 0.2 && deltaFiles < 0.2) {
                        avgTimePerItem +=
                            h.durationSec /
                            (h.foldersCount + h.filesCount / 10);
                        countSimilar++;
                    }
                });
                avgTimePerItem /= countSimilar;
                eta = remainingItems * avgTimePerItem;

                if (
                    logs.some(
                        (l) => l.includes('timeout') || l.includes('rate')
                    )
                ) {
                    eta *= 1.2;
                }

                eta *= 1.15;
                if (countSimilar > 5) eta *= 1.1;

                setEtaSeconds(Math.max(0, Math.round(eta)));
            } else {
                setHasPrevData(false);
                setEstimatedFolders(null);
                setEstimatedFiles(null);
                setEtaSeconds(elapsedSeconds);
            }
        } else {
            setEtaSeconds(null);
        }
    }, [scanning, elapsedSeconds, logs, savedFolders, folderId, progress]);

    const loadSavedFolders = async () => {
        try {
            const folders = await invoke<SavedFolder[]>('get_saved_folders');
            setSavedFolders(folders);
        } catch (err) {
            console.error('Ошибка загрузки папок:', err);
        }
    };

    const extractFolderId = (input: string): string | null => {
        // Паттерн строгой ссылки: https://drive.google.com/drive/u/0/folders/...
        const strictUrlPattern =
            /^https:\/\/drive\.google\.com\/drive\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/;
        const match = input.match(strictUrlPattern);
        return match ? match[1] : null;
    };

    const isValidId = (input: string): boolean => {
        // ID — это строка из букв, цифр, _, -
        return /^[a-zA-Z0-9_-]+$/.test(input);
    };

    const handleInputBlur = async () => {
        const input = folderId.trim();
        if (!input) {
            setIdError('');
            setValidating(false);
            return;
        }

        setValidating(true);

        // Пытаемся распарсить как ссылку
        const extractedId = extractFolderId(input);

        if (extractedId) {
            // Это похоже на ссылку
            try {
                await invoke('is_this_folder', { itemId: extractedId });
                // Успех — заменяем содержимое на ID
                setFolderId(extractedId);
                setIdError('');
            } catch (err: any) {
                setIdError(
                    'Ссылка выглядит корректно, но папка не найдена или недоступна'
                );
            }
        } else if (isValidId(input)) {
            // Это похоже на ID
            try {
                await invoke('is_this_folder', { itemId: input });
                setIdError('');
            } catch (err: any) {
                setIdError('ID не найден в Google Drive или недоступен');
            }
        } else {
            // Это говно
            setIdError(
                'Введите ID папки или ссылку формата: https://drive.google.com/drive/u/0/folders/...'
            );
        }

        setValidating(false);
    };

    const handleScan = async () => {
        if (!folderId.trim()) {
            setLogs(['Укажи ID папки']);
            return;
        }

        setScanning(true);
        setLogs([]);
        setNewLogsCount(0);
        setProgress({ foldersProcessed: 0, filesProcessed: 0 });
        setElapsedSeconds(0);
        setEtaSeconds(null);
        setHasPrevData(false);
        setEstimatedFolders(null);
        setEstimatedFiles(null);

        try {
            const data = await invoke<AuditResult>('audit_drive', {
                folderId: folderId.trim(),
            });

            // Результат получен успешно - переходим на экран результатов
            await loadSavedFolders();
            onScanComplete(data);
        } catch (e: any) {
            const errorStr = e.toString();

            // Если это отмена - просто логируем, НЕ вызываем onScanComplete
            if (errorStr.includes('Cancelled')) {
                setLogs((prev) => [...prev, '⚠️ Сканирование отменено']);
            } else {
                setLogs((prev) => [...prev, `Ошибка: ${errorStr}`]);
            }
            // При ошибке или отмене остаёмся на экране скана (scanning=true)
        } finally {
            setScanning(false);
        }
    };
    const handleCancel = async () => {
        setLogs((prev) => [...prev, '🛑 Отменяем сканирование...']);
        await invoke('cancel_audit_drive');
    };

    const formatSeconds = (sec: number) => {
        const min = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${min > 0 ? min + ' мин ' : ''}${s} сек`;
    };

    if (!scanning) {
        return (
            <Box
                sx={{
                    minHeight: '100vh',
                    background: (theme) =>
                        `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
                    p: 3,
                }}
            >
                <Box sx={{ mb: 3 }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            mb: 2,
                        }}
                    >
                        <IconButton
                            onClick={async () => {
                                await handleCancel();
                                setCurrentPage('main');
                            }}
                            sx={{
                                bgcolor: alpha('#1976d2', 0.1),
                                '&:hover': { bgcolor: alpha('#1976d2', 0.2) },
                            }}
                        >
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography
                            variant='h4'
                            sx={{
                                fontWeight: 800,
                                background:
                                    'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                backgroundClip: 'text',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            Аудит доступов
                        </Typography>
                    </Box>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        Сканирование и управление доступами Google Drive
                    </Typography>
                </Box>

                <Box sx={{ maxWidth: 900, mx: 'auto' }}>
                    <Card
                        sx={{
                            p: 4,
                            border: 1,
                            borderColor: 'divider',
                        }}
                    >
                        <Box sx={{ mb: 3 }}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    mb: 1.5,
                                }}
                            >
                                <Typography
                                    variant='subtitle2'
                                    sx={{ fontWeight: 600 }}
                                >
                                    ID или ссылка на папку
                                </Typography>
                                <Tooltip
                                    title={
                                        <Box>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    display: 'block',
                                                    mb: 0.5,
                                                }}
                                            >
                                                Вставьте ID или полную ссылку:
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    display: 'block',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.7rem',
                                                }}
                                            >
                                                https://drive.google.com/drive/u/0/folders/
                                                <strong>1EHOqUs...</strong>
                                            </Typography>
                                        </Box>
                                    }
                                    arrow
                                >
                                    <HelpOutlineIcon
                                        sx={{
                                            fontSize: 18,
                                            color: 'text.secondary',
                                            cursor: 'help',
                                        }}
                                    />
                                </Tooltip>
                            </Box>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                    fullWidth
                                    value={folderId}
                                    onChange={(e) =>
                                        setFolderId(e.target.value)
                                    }
                                    placeholder='1EHOqUs... или https://drive.google.com/drive/u/0/folders/...'
                                    disabled={scanning || validating}
                                    onBlur={handleInputBlur}
                                    error={Boolean(idError)}
                                    helperText={
                                        validating
                                            ? 'Проверяем...'
                                            : idError ||
                                              'ID или полная ссылка на папку'
                                    }
                                    sx={{
                                        '& .MuiInputBase-root': {
                                            fontFamily: 'monospace',
                                            fontSize: 13,
                                        },
                                    }}
                                    InputProps={{
                                        endAdornment: validating ? (
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: 16,
                                                        height: 16,
                                                        border: 2,
                                                        borderColor:
                                                            'primary.main',
                                                        borderTopColor:
                                                            'transparent',
                                                        borderRadius: '50%',
                                                        animation:
                                                            'spin 0.8s linear infinite',
                                                        '@keyframes spin': {
                                                            '0%': {
                                                                transform:
                                                                    'rotate(0deg)',
                                                            },
                                                            '100%': {
                                                                transform:
                                                                    'rotate(360deg)',
                                                            },
                                                        },
                                                    }}
                                                />
                                            </Box>
                                        ) : null,
                                    }}
                                />
                                <FolderSelector
                                    folderId={folderId}
                                    isScanning={scanning}
                                    hasIdError={Boolean(idError)}
                                    savedFolders={savedFolders}
                                    onFolderSelect={setFolderId}
                                    onFoldersUpdate={loadSavedFolders}
                                />
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                                variant='contained'
                                fullWidth
                                onClick={handleScan}
                                disabled={
                                    scanning ||
                                    !folderId.trim() ||
                                    Boolean(idError)
                                }
                                startIcon={<PlayArrowIcon />}
                                sx={{
                                    py: 1.5,
                                    fontWeight: 600,
                                    textTransform: 'none',
                                    fontSize: 16,
                                }}
                            >
                                Запустить аудит
                            </Button>

                            <LogDrawer
                                logs={logs}
                                isOpen={drawerOpen}
                                onOpen={() => {
                                    setDrawerOpen(true);
                                    setNewLogsCount(0);
                                }}
                                onClose={() => setDrawerOpen(false)}
                                newLogsCount={newLogsCount}
                            />
                        </Box>
                    </Card>
                </Box>
            </Box>
        );
    }
    // Во время скана — sticky-карточка слева + Tree+Pulse справа
    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                gap: 3,
                p: 3,
                background: (theme) =>
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
            }}
        >
            {/* Sticky-карточка слева */}
            <Box
                sx={{
                    width: 420,
                    flexShrink: 0,
                    position: 'sticky',
                    top: 24,
                    alignSelf: 'flex-start',
                }}
            >
                <Card
                    sx={{
                        p: 4,
                        border: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Box sx={{ mb: 3 }}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                mb: 2,
                            }}
                        >
                            <IconButton
                                onClick={() => setCurrentPage('main')}
                                sx={{
                                    bgcolor: alpha('#1976d2', 0.1),
                                    '&:hover': {
                                        bgcolor: alpha('#1976d2', 0.2),
                                    },
                                }}
                            >
                                <ArrowBackIcon />
                            </IconButton>
                            <Typography
                                variant='h5'
                                component='h1'
                                sx={{
                                    fontWeight: 800,
                                    background:
                                        'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                    backgroundClip: 'text',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                }}
                            >
                                Аудит доступов
                            </Typography>
                        </Box>
                        <Typography
                            variant='body2'
                            sx={{ color: 'text.secondary' }}
                        >
                            Сканирование и управление доступами Google Drive
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 3 }}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mb: 1.5,
                            }}
                        >
                            <Typography
                                variant='subtitle2'
                                sx={{ fontWeight: 600 }}
                            >
                                ID или ссылка на папку
                            </Typography>
                            <Tooltip
                                title={
                                    <Box>
                                        <Typography
                                            variant='caption'
                                            sx={{ display: 'block', mb: 0.5 }}
                                        >
                                            Вставьте ID или полную ссылку:
                                        </Typography>
                                        <Typography
                                            variant='caption'
                                            sx={{
                                                display: 'block',
                                                fontFamily: 'monospace',
                                                fontSize: '0.7rem',
                                            }}
                                        >
                                            https://drive.google.com/drive/u/0/folders/
                                            <strong>1EHOqUs...</strong>
                                        </Typography>
                                    </Box>
                                }
                                arrow
                            >
                                <HelpOutlineIcon
                                    sx={{
                                        fontSize: 18,
                                        color: 'text.secondary',
                                        cursor: 'help',
                                    }}
                                />
                            </Tooltip>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField
                                fullWidth
                                value={folderId}
                                onChange={(e) => setFolderId(e.target.value)}
                                placeholder='1EHOqUs... или https://drive.google.com/drive/u/0/folders/...'
                                disabled={scanning || validating}
                                onBlur={handleInputBlur}
                                error={Boolean(idError)}
                                helperText={
                                    validating
                                        ? 'Проверяем...'
                                        : idError ||
                                          'ID или полная ссылка на папку'
                                }
                                sx={{
                                    '& .MuiInputBase-root': {
                                        fontFamily: 'monospace',
                                        fontSize: 13,
                                    },
                                }}
                                InputProps={{
                                    endAdornment: validating ? (
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    width: 16,
                                                    height: 16,
                                                    border: 2,
                                                    borderColor: 'primary.main',
                                                    borderTopColor:
                                                        'transparent',
                                                    borderRadius: '50%',
                                                    animation:
                                                        'spin 0.8s linear infinite',
                                                    '@keyframes spin': {
                                                        '0%': {
                                                            transform:
                                                                'rotate(0deg)',
                                                        },
                                                        '100%': {
                                                            transform:
                                                                'rotate(360deg)',
                                                        },
                                                    },
                                                }}
                                            />
                                        </Box>
                                    ) : null,
                                }}
                            />
                            <FolderSelector
                                folderId={folderId}
                                isScanning={scanning}
                                hasIdError={Boolean(idError)}
                                savedFolders={savedFolders}
                                onFolderSelect={setFolderId}
                                onFoldersUpdate={loadSavedFolders}
                            />
                        </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                        <Button
                            variant='outlined'
                            color='error'
                            fullWidth
                            onClick={handleCancel}
                            startIcon={<StopIcon />}
                            sx={{
                                py: 1.5,
                                fontWeight: 600,
                                textTransform: 'none',
                            }}
                        >
                            Отменить
                        </Button>
                        <LogDrawer
                            logs={logs}
                            isOpen={drawerOpen}
                            onOpen={() => {
                                setDrawerOpen(true);
                                setNewLogsCount(0);
                            }}
                            onClose={() => setDrawerOpen(false)}
                            newLogsCount={newLogsCount}
                        />
                    </Box>

                    <Card
                        sx={{
                            p: 3,
                            bgcolor: alpha('#1976d2', 0.05),
                            border: 1,
                            borderColor: alpha('#1976d2', 0.2),
                        }}
                    >
                        <LinearProgress
                            variant={
                                hasPrevData ? 'determinate' : 'indeterminate'
                            }
                            value={
                                hasPrevData &&
                                estimatedFolders &&
                                estimatedFiles
                                    ? ((progress.foldersProcessed +
                                          progress.filesProcessed / 10) /
                                          (estimatedFolders +
                                              estimatedFiles / 10)) *
                                      100
                                    : undefined
                            }
                            sx={{
                                height: 8,
                                borderRadius: 1,
                                bgcolor: alpha('#000', 0.1),
                                '& .MuiLinearProgress-bar': {
                                    bgcolor: 'primary.main',
                                },
                            }}
                        />
                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                mt: 2,
                                flexWrap: 'wrap',
                                gap: 1,
                            }}
                        >
                            <Chip
                                label={`Прошло: ${formatSeconds(elapsedSeconds)}`}
                                size='small'
                                sx={{ fontWeight: 500 }}
                            />
                            {etaSeconds !== null && (
                                <Chip
                                    label={`Осталось ≈ ${formatSeconds(etaSeconds)}`}
                                    size='small'
                                    color='primary'
                                    sx={{ fontWeight: 500 }}
                                />
                            )}
                        </Box>
                        <Typography
                            variant='caption'
                            sx={{
                                display: 'block',
                                mt: 1.5,
                                textAlign: 'center',
                                color: 'text.secondary',
                            }}
                        >
                            Обработано: {progress.foldersProcessed} папок /{' '}
                            {progress.filesProcessed} файлов
                            {hasPrevData &&
                                estimatedFolders &&
                                estimatedFiles && (
                                    <>
                                        {' '}
                                        / ~{estimatedFolders} папок / ~
                                        {estimatedFiles} файлов
                                    </>
                                )}
                        </Typography>
                    </Card>
                </Card>
            </Box>

            {/* Tree + Pulse справа на всю высоту */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Card
                    sx={{
                        height: 'calc(100vh - 48px)',
                        overflow: 'hidden',
                        border: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Box sx={{ height: 'calc(100% - 90px)' }}>
                        <Tree />
                    </Box>
                    <Box sx={{ height: 90 }}>
                        <ScanPulse />
                        return (
                        <Box
                            sx={{
                                minHeight: '100vh',
                                display: 'flex',
                                gap: 3,
                                p: 3,
                                background: (theme) =>
                                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
                            }}
                        >
                            {/* Sticky-карточка слева */}
                            <Box
                                sx={{
                                    width: 420,
                                    flexShrink: 0,
                                    position: 'sticky',
                                    top: 24,
                                    alignSelf: 'flex-start',
                                }}
                            >
                                <Card
                                    sx={{
                                        p: 4,
                                        border: 1,
                                        borderColor: 'divider',
                                    }}
                                >
                                    <Box sx={{ mb: 3 }}>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 2,
                                                mb: 2,
                                            }}
                                        >
                                            <IconButton
                                                onClick={() =>
                                                    setCurrentPage('main')
                                                }
                                                sx={{
                                                    bgcolor: alpha(
                                                        '#1976d2',
                                                        0.1
                                                    ),
                                                    '&:hover': {
                                                        bgcolor: alpha(
                                                            '#1976d2',
                                                            0.2
                                                        ),
                                                    },
                                                }}
                                            >
                                                <ArrowBackIcon />
                                            </IconButton>
                                            <Typography
                                                variant='h5'
                                                component='h1'
                                                sx={{
                                                    fontWeight: 800,
                                                    background:
                                                        'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                                    backgroundClip: 'text',
                                                    WebkitBackgroundClip:
                                                        'text',
                                                    WebkitTextFillColor:
                                                        'transparent',
                                                }}
                                            >
                                                Аудит доступов
                                            </Typography>
                                        </Box>
                                        <Typography
                                            variant='body2'
                                            sx={{ color: 'text.secondary' }}
                                        >
                                            Сканирование и управление доступами
                                            Google Drive
                                        </Typography>
                                    </Box>

                                    <Box sx={{ mb: 3 }}>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1,
                                                mb: 1.5,
                                            }}
                                        >
                                            <Typography
                                                variant='subtitle2'
                                                sx={{ fontWeight: 600 }}
                                            >
                                                ID или ссылка на папку
                                            </Typography>
                                            <Tooltip
                                                title={
                                                    <Box>
                                                        <Typography
                                                            variant='caption'
                                                            sx={{
                                                                display:
                                                                    'block',
                                                                mb: 0.5,
                                                            }}
                                                        >
                                                            Вставьте ID или
                                                            полную ссылку:
                                                        </Typography>
                                                        <Typography
                                                            variant='caption'
                                                            sx={{
                                                                display:
                                                                    'block',
                                                                fontFamily:
                                                                    'monospace',
                                                                fontSize:
                                                                    '0.7rem',
                                                            }}
                                                        >
                                                            https://drive.google.com/drive/u/0/folders/
                                                            <strong>
                                                                1EHOqUs...
                                                            </strong>
                                                        </Typography>
                                                    </Box>
                                                }
                                                arrow
                                            >
                                                <HelpOutlineIcon
                                                    sx={{
                                                        fontSize: 18,
                                                        color: 'text.secondary',
                                                        cursor: 'help',
                                                    }}
                                                />
                                            </Tooltip>
                                        </Box>

                                        <Box sx={{ display: 'flex', gap: 1 }}>
                                            <TextField
                                                fullWidth
                                                value={folderId}
                                                onChange={(e) =>
                                                    setFolderId(e.target.value)
                                                }
                                                placeholder='1EHOqUs... или https://drive.google.com/drive/u/0/folders/...'
                                                disabled={
                                                    scanning || validating
                                                }
                                                onBlur={handleInputBlur}
                                                error={Boolean(idError)}
                                                helperText={
                                                    validating
                                                        ? 'Проверяем...'
                                                        : idError ||
                                                          'ID или полная ссылка на папку'
                                                }
                                                sx={{
                                                    '& .MuiInputBase-root': {
                                                        fontFamily: 'monospace',
                                                        fontSize: 13,
                                                    },
                                                }}
                                                InputProps={{
                                                    endAdornment: validating ? (
                                                        <Box
                                                            sx={{
                                                                display: 'flex',
                                                                alignItems:
                                                                    'center',
                                                            }}
                                                        >
                                                            <Box
                                                                sx={{
                                                                    width: 16,
                                                                    height: 16,
                                                                    border: 2,
                                                                    borderColor:
                                                                        'primary.main',
                                                                    borderTopColor:
                                                                        'transparent',
                                                                    borderRadius:
                                                                        '50%',
                                                                    animation:
                                                                        'spin 0.8s linear infinite',
                                                                    '@keyframes spin':
                                                                        {
                                                                            '0%': {
                                                                                transform:
                                                                                    'rotate(0deg)',
                                                                            },
                                                                            '100%': {
                                                                                transform:
                                                                                    'rotate(360deg)',
                                                                            },
                                                                        },
                                                                }}
                                                            />
                                                        </Box>
                                                    ) : null,
                                                }}
                                            />
                                            <FolderSelector
                                                folderId={folderId}
                                                isScanning={scanning}
                                                hasIdError={Boolean(idError)}
                                                savedFolders={savedFolders}
                                                onFolderSelect={setFolderId}
                                                onFoldersUpdate={
                                                    loadSavedFolders
                                                }
                                            />
                                        </Box>
                                    </Box>

                                    <Box
                                        sx={{ display: 'flex', gap: 2, mb: 3 }}
                                    >
                                        <Button
                                            variant='outlined'
                                            color='error'
                                            fullWidth
                                            onClick={handleCancel}
                                            startIcon={<StopIcon />}
                                            sx={{
                                                py: 1.5,
                                                fontWeight: 600,
                                                textTransform: 'none',
                                            }}
                                        >
                                            Отменить
                                        </Button>
                                        <LogDrawer
                                            logs={logs}
                                            isOpen={drawerOpen}
                                            onOpen={() => {
                                                setDrawerOpen(true);
                                                setNewLogsCount(0);
                                            }}
                                            onClose={() => setDrawerOpen(false)}
                                            newLogsCount={newLogsCount}
                                        />
                                    </Box>

                                    <Card
                                        sx={{
                                            p: 3,
                                            bgcolor: alpha('#1976d2', 0.05),
                                            border: 1,
                                            borderColor: alpha('#1976d2', 0.2),
                                        }}
                                    >
                                        <LinearProgress
                                            variant={
                                                hasPrevData
                                                    ? 'determinate'
                                                    : 'indeterminate'
                                            }
                                            value={
                                                hasPrevData &&
                                                estimatedFolders &&
                                                estimatedFiles
                                                    ? ((progress.foldersProcessed +
                                                          progress.filesProcessed /
                                                              10) /
                                                          (estimatedFolders +
                                                              estimatedFiles /
                                                                  10)) *
                                                      100
                                                    : undefined
                                            }
                                            sx={{
                                                height: 8,
                                                borderRadius: 1,
                                                bgcolor: alpha('#000', 0.1),
                                                '& .MuiLinearProgress-bar': {
                                                    bgcolor: 'primary.main',
                                                },
                                            }}
                                        />
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                mt: 2,
                                                flexWrap: 'wrap',
                                                gap: 1,
                                            }}
                                        >
                                            <Chip
                                                label={`Прошло: ${formatSeconds(elapsedSeconds)}`}
                                                size='small'
                                                sx={{ fontWeight: 500 }}
                                            />
                                            {etaSeconds !== null && (
                                                <Chip
                                                    label={`Осталось ≈ ${formatSeconds(etaSeconds)}`}
                                                    size='small'
                                                    color='primary'
                                                    sx={{ fontWeight: 500 }}
                                                />
                                            )}
                                        </Box>
                                        <Typography
                                            variant='caption'
                                            sx={{
                                                display: 'block',
                                                mt: 1.5,
                                                textAlign: 'center',
                                                color: 'text.secondary',
                                            }}
                                        >
                                            Обработано:{' '}
                                            {progress.foldersProcessed} папок /{' '}
                                            {progress.filesProcessed} файлов
                                            {hasPrevData &&
                                                estimatedFolders &&
                                                estimatedFiles && (
                                                    <>
                                                        {' '}
                                                        / ~{
                                                            estimatedFolders
                                                        }{' '}
                                                        папок / ~
                                                        {estimatedFiles} файлов
                                                    </>
                                                )}
                                        </Typography>
                                    </Card>
                                </Card>
                            </Box>

                            {/* Tree + Pulse справа на всю высоту */}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Card
                                    sx={{
                                        height: 'calc(100vh - 48px)',
                                        overflow: 'hidden',
                                        border: 1,
                                        borderColor: 'divider',
                                    }}
                                >
                                    <Box sx={{ height: 'calc(100% - 90px)' }}>
                                        <Tree />
                                    </Box>
                                    <Box sx={{ height: 90 }}>
                                        <ScanPulse />
                                    </Box>
                                </Card>
                            </Box>
                        </Box>
                        );
                    </Box>
                </Card>
            </Box>
        </Box>
    );
};

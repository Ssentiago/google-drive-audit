import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    Container,
    Card,
    Typography,
    TextField,
    Button,
    Box,
    IconButton,
    Paper,
    Chip,
    Tooltip,
    Drawer,
    Badge,
    alpha,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import TerminalIcon from '@mui/icons-material/Terminal';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PersonIcon from '@mui/icons-material/Person';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useGlobalContext } from '../../../../core/GlobalContext.tsx';

interface FileMetadata {
    id: string;
    name: string;
    url: string;
    owner: string;
    permissions: Permission[];
}

interface Permission {
    id: string;
    email: string;
    displayName: string;
    role: string;
    type: string;
}

const DirectScan = () => {
    const [inputText, setInputText] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [results, setResults] = useState<FileMetadata[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);
    const { setCurrentPage, userEmail } = useGlobalContext();
    const [driveFileStatuses, setDriveFileStatuses] = useState<
        Record<string, boolean>
    >({});
    const logBoxRef = useRef<HTMLPreElement>(null);

    const isDriveItem = async (fileId: string) => {
        try {
            return await invoke<boolean>('is_drive_item', { fileId });
        } catch {
            return false;
        }
    };

    useEffect(() => {
        const checkFiles = async () => {
            const statuses: Record<string, boolean> = {};
            await Promise.all(
                results.map(async (file) => {
                    statuses[file.id] = await isDriveItem(file.id);
                })
            );
            setDriveFileStatuses(statuses);
        };

        if (results.length > 0) {
            checkFiles();
        }
    }, [results]);

    useEffect(() => {
        let unlistenFn: (() => void) | undefined;

        listen<string>('direct_scan_log', (event) => {
            setLogs((prev) => [...prev, event.payload]);
            if (!drawerOpen) {
                setNewLogsCount((c) => c + 1);
            }
        }).then((fn) => {
            unlistenFn = fn;
        });

        return () => {
            unlistenFn?.();
        };
    }, [drawerOpen]);

    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [logs]);

    const extractFileIds = (text: string): string[] => {
        const patterns = [
            /https?:\/\/drive\.google\.com\/[^\s]*?\/d\/([a-zA-Z0-9_-]+)/g,
            /https?:\/\/drive\.google\.com\/[^\s]*?\/folders\/([a-zA-Z0-9_-]+)/g,
            /https?:\/\/drive\.google\.com\/[^\s]*?[?&]id=([a-zA-Z0-9_-]+)/g,
        ];

        const ids = new Set<string>();

        patterns.forEach((pattern) => {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                ids.add(match[1]);
            }
        });

        const standalonePattern = /\b([a-zA-Z0-9_-]{20,})\b/g;
        const standaloneMatches = text.matchAll(standalonePattern);
        for (const match of standaloneMatches) {
            ids.add(match[1]);
        }

        return Array.from(ids);
    };

    const handleScan = async () => {
        const fileIds = extractFileIds(inputText);

        if (fileIds.length === 0) {
            setLogs(['Не найдено валидных ссылок или ID']);
            return;
        }

        setIsScanning(true);
        setLogs([]);
        setResults([]);
        setNewLogsCount(0);

        try {
            const metadata = await invoke<FileMetadata[]>('scan_files_direct', {
                fileIds,
            });

            setResults(metadata);
            setLogs((prev) => [
                ...prev,
                `✅ Просканировано ${metadata.length} файлов`,
            ]);
        } catch (error: any) {
            setLogs((prev) => [...prev, `❌ Ошибка: ${error}`]);
        } finally {
            setIsScanning(false);
        }
    };

    const handleRemovePermission = async (
        fileId: string,
        permissionId: string
    ) => {
        try {
            await invoke('remove_permission', {
                fileId,
                permissionId,
                window: window,
            });

            setResults((prev) =>
                prev.map((file) =>
                    file.id === fileId
                        ? {
                              ...file,
                              permissions: file.permissions.filter(
                                  (p) => p.id !== permissionId
                              ),
                          }
                        : file
                )
            );

            setLogs((prev) => [...prev, `✅ Доступ удалён`]);
        } catch (error: any) {
            setLogs((prev) => [...prev, `❌ Ошибка удаления: ${error}`]);
        }
    };

    const handleCopyWithoutOwner = async (file: FileMetadata) => {
        try {
            await invoke('copy_file_without_owner', {
                fileId: file.id,
                fileName: file.name,
                ownerEmail: file.owner,
            });

            setLogs((prev) => [
                ...prev,
                `✅ Копия создана: КОПИЯ | ${file.name}`,
            ]);
        } catch (error: any) {
            setLogs((prev) => [...prev, `❌ Ошибка копирования: ${error}`]);
        }
    };

    const roleColor = (role: string) => {
        switch (role) {
            case 'owner':
                return 'error';
            case 'writer':
                return 'warning';
            case 'commenter':
                return 'info';
            default:
                return 'default';
        }
    };

    const roleLabel = (role: string) => {
        switch (role) {
            case 'owner':
                return 'Владелец';
            case 'writer':
                return 'Редактор';
            case 'commenter':
                return 'Комментатор';
            case 'reader':
                return 'Читатель';
            default:
                return role;
        }
    };

    const foundIds = extractFileIds(inputText);

    const handleOpenDrawer = () => {
        setDrawerOpen(true);
        setNewLogsCount(0);
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                py: 4,
                background: (theme) =>
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
            }}
        >
            <Container maxWidth='lg'>
                <Card
                    sx={{
                        p: 5,
                        borderRadius: 3,
                        boxShadow: (theme) =>
                            `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
                    }}
                >
                    {/* Header */}
                    <Box sx={{ mb: 4 }}>
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
                                variant='h4'
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
                                Прямое сканирование
                            </Typography>
                        </Box>
                        <Typography
                            variant='body2'
                            sx={{ color: 'text.secondary' }}
                        >
                            Быстрая проверка конкретных файлов по ссылкам или ID
                        </Typography>
                    </Box>

                    {/* Input Form */}
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            variant='subtitle2'
                            sx={{ mb: 1.5, fontWeight: 600 }}
                        >
                            Ссылки или ID файлов
                            <Typography
                                component='span'
                                sx={{
                                    ml: 1,
                                    fontSize: 12,
                                    fontWeight: 400,
                                    color: 'text.secondary',
                                }}
                            >
                                (можно вставить всё скопом)
                            </Typography>
                        </Typography>
                        <TextField
                            fullWidth
                            multiline
                            rows={6}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder='https://drive.google.com/file/d/1abc...&#10;1xyz...&#10;https://drive.google.com/...'
                            disabled={isScanning}
                            sx={{
                                mb: 1.5,
                                '& .MuiInputBase-root': {
                                    fontFamily: 'monospace',
                                    fontSize: 14,
                                },
                            }}
                        />

                        {foundIds.length > 0 && (
                            <Box
                                sx={{
                                    mb: 2,
                                    display: 'flex',
                                    gap: 1,
                                    alignItems: 'center',
                                }}
                            >
                                <CheckCircleIcon
                                    sx={{ fontSize: 16, color: 'success.main' }}
                                />
                                <Typography
                                    variant='caption'
                                    sx={{
                                        color: 'success.main',
                                        fontWeight: 500,
                                    }}
                                >
                                    Найдено файлов: {foundIds.length}
                                </Typography>
                            </Box>
                        )}

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                                variant='contained'
                                fullWidth
                                onClick={handleScan}
                                disabled={isScanning || foundIds.length === 0}
                                startIcon={<PlayArrowIcon />}
                                sx={{
                                    py: 1.5,
                                    fontWeight: 600,
                                    textTransform: 'none',
                                    fontSize: 16,
                                }}
                            >
                                {isScanning
                                    ? 'Сканирование...'
                                    : 'Сканировать файлы'}
                            </Button>

                            {logs.length > 0 && (
                                <Tooltip title='Открыть логи'>
                                    <IconButton
                                        onClick={handleOpenDrawer}
                                        sx={{
                                            bgcolor: alpha('#1976d2', 0.1),
                                            '&:hover': {
                                                bgcolor: alpha('#1976d2', 0.2),
                                            },
                                        }}
                                    >
                                        <Badge
                                            badgeContent={newLogsCount}
                                            color='error'
                                        >
                                            <TerminalIcon />
                                        </Badge>
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>
                    </Box>

                    {/* Results */}
                    {results.length > 0 && (
                        <Box sx={{ mt: 4 }}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    mb: 3,
                                }}
                            >
                                <Typography
                                    variant='h5'
                                    sx={{ fontWeight: 700 }}
                                >
                                    Результаты
                                </Typography>
                                <Chip
                                    label={results.length}
                                    color='primary'
                                    size='small'
                                    sx={{ fontWeight: 600 }}
                                />
                            </Box>

                            {results.map((file) => {
                                const isDriveFile =
                                    driveFileStatuses[file.id] ?? false;

                                return (
                                    <Card
                                        key={file.id}
                                        sx={{
                                            p: 3,
                                            mb: 2,
                                            border: 1,
                                            borderColor: 'divider',
                                            transition: 'all 0.2s',
                                            '&:hover': {
                                                borderColor: 'primary.main',
                                                transform: 'translateY(-2px)',
                                                boxShadow: (theme) =>
                                                    `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
                                            },
                                        }}
                                    >
                                        {/* File Header */}
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'flex-start',
                                                mb: 3,
                                                pb: 2,
                                                borderBottom: 1,
                                                borderColor: 'divider',
                                            }}
                                        >
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Typography
                                                    variant='h6'
                                                    sx={{
                                                        fontWeight: 600,
                                                        mb: 1,
                                                        overflow: 'hidden',
                                                        textOverflow:
                                                            'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {file.name}
                                                </Typography>
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                    }}
                                                >
                                                    <PersonIcon
                                                        sx={{
                                                            fontSize: 16,
                                                            color: 'text.secondary',
                                                        }}
                                                    />
                                                    <Typography
                                                        variant='body2'
                                                        sx={{
                                                            color: 'text.secondary',
                                                        }}
                                                    >
                                                        {file.owner}
                                                    </Typography>
                                                </Box>
                                            </Box>

                                            <Tooltip
                                                title={
                                                    !isDriveFile
                                                        ? 'Это не файл Google Drive'
                                                        : 'Создать копию с вами как владельцем'
                                                }
                                            >
                                                <span>
                                                    <Button
                                                        variant='contained'
                                                        size='small'
                                                        onClick={() =>
                                                            handleCopyWithoutOwner(
                                                                file
                                                            )
                                                        }
                                                        disabled={!isDriveFile}
                                                        startIcon={
                                                            <SwapHorizIcon />
                                                        }
                                                        sx={{
                                                            textTransform:
                                                                'none',
                                                            fontWeight: 600,
                                                            whiteSpace:
                                                                'nowrap',
                                                        }}
                                                    >
                                                        Сменить владельца
                                                    </Button>
                                                </span>
                                            </Tooltip>
                                        </Box>

                                        {/* Permissions */}
                                        <Typography
                                            variant='caption'
                                            sx={{
                                                display: 'block',
                                                mb: 2,
                                                fontWeight: 600,
                                                color: 'text.secondary',
                                                letterSpacing: 0.5,
                                            }}
                                        >
                                            ДОСТУПЫ ({file.permissions.length})
                                        </Typography>

                                        {file.permissions.length === 0 ? (
                                            <Box
                                                sx={{
                                                    textAlign: 'center',
                                                    py: 3,
                                                    bgcolor: alpha(
                                                        '#000',
                                                        0.02
                                                    ),
                                                    borderRadius: 1,
                                                }}
                                            >
                                                <Typography
                                                    variant='body2'
                                                    sx={{
                                                        color: 'text.secondary',
                                                    }}
                                                >
                                                    Нет дополнительных доступов
                                                </Typography>
                                            </Box>
                                        ) : (
                                            <Box
                                                sx={{
                                                    display: 'grid',
                                                    gridTemplateColumns: {
                                                        xs: '1fr',
                                                        md: 'repeat(2, 1fr)',
                                                    },
                                                    gap: 1.5,
                                                }}
                                            >
                                                {file.permissions.map(
                                                    (perm) => (
                                                        <Paper
                                                            key={perm.id}
                                                            variant='outlined'
                                                            sx={{
                                                                p: 2,
                                                                display: 'flex',
                                                                justifyContent:
                                                                    'space-between',
                                                                alignItems:
                                                                    'center',
                                                                transition:
                                                                    'all 0.2s',
                                                                '&:hover': {
                                                                    bgcolor:
                                                                        alpha(
                                                                            '#1976d2',
                                                                            0.05
                                                                        ),
                                                                    borderColor:
                                                                        'primary.main',
                                                                },
                                                            }}
                                                        >
                                                            <Box
                                                                sx={{
                                                                    flex: 1,
                                                                    minWidth: 0,
                                                                    mr: 1,
                                                                }}
                                                            >
                                                                <Typography
                                                                    variant='body2'
                                                                    sx={{
                                                                        fontWeight: 600,
                                                                        overflow:
                                                                            'hidden',
                                                                        textOverflow:
                                                                            'ellipsis',
                                                                        whiteSpace:
                                                                            'nowrap',
                                                                        mb: 0.5,
                                                                    }}
                                                                >
                                                                    {perm.displayName ||
                                                                        perm.email}
                                                                </Typography>
                                                                <Typography
                                                                    variant='caption'
                                                                    sx={{
                                                                        color: 'text.secondary',
                                                                        display:
                                                                            'block',
                                                                        overflow:
                                                                            'hidden',
                                                                        textOverflow:
                                                                            'ellipsis',
                                                                        whiteSpace:
                                                                            'nowrap',
                                                                        fontFamily:
                                                                            'monospace',
                                                                        fontSize: 11,
                                                                    }}
                                                                >
                                                                    {perm.email}
                                                                </Typography>
                                                            </Box>

                                                            <Box
                                                                sx={{
                                                                    display:
                                                                        'flex',
                                                                    gap: 1,
                                                                    alignItems:
                                                                        'center',
                                                                }}
                                                            >
                                                                <Chip
                                                                    label={roleLabel(
                                                                        perm.role
                                                                    )}
                                                                    color={roleColor(
                                                                        perm.role
                                                                    )}
                                                                    size='small'
                                                                    sx={{
                                                                        fontWeight: 500,
                                                                    }}
                                                                />
                                                                {perm.role !==
                                                                    'owner' &&
                                                                    perm.email !==
                                                                        userEmail && (
                                                                        <Tooltip title='Удалить доступ'>
                                                                            <IconButton
                                                                                size='small'
                                                                                onClick={() =>
                                                                                    handleRemovePermission(
                                                                                        file.id,
                                                                                        perm.id
                                                                                    )
                                                                                }
                                                                                sx={{
                                                                                    color: 'error.main',
                                                                                    '&:hover':
                                                                                        {
                                                                                            bgcolor:
                                                                                                alpha(
                                                                                                    '#f44336',
                                                                                                    0.1
                                                                                                ),
                                                                                        },
                                                                                }}
                                                                            >
                                                                                <DeleteIcon fontSize='small' />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                            </Box>
                                                        </Paper>
                                                    )
                                                )}
                                            </Box>
                                        )}
                                    </Card>
                                );
                            })}
                        </Box>
                    )}
                </Card>
            </Container>

            {/* Logs Drawer */}
            <Drawer
                anchor='right'
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            >
                <Box sx={{ width: 600, p: 3 }}>
                    <Typography
                        variant='h6'
                        sx={{ mb: 2, fontWeight: 600 }}
                    >
                        Лог сканирования
                    </Typography>
                    <Box
                        component='pre'
                        ref={logBoxRef}
                        sx={{
                            bgcolor: '#1e1e1e',
                            color: '#d4d4d4',
                            p: 2,
                            borderRadius: 1,
                            height: 'calc(100vh - 120px)',
                            overflow: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            lineHeight: 1.5,
                            m: 0,
                        }}
                    >
                        {logs.join('\n')}
                    </Box>
                </Box>
            </Drawer>
        </Box>
    );
};

export default DirectScan;

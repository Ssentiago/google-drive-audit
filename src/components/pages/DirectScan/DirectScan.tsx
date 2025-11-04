import { useEffect, useState } from 'react';
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
    List,
    ListItem,
    Paper,
    Chip,
    Divider,
    Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useGlobalContext } from '../../../core/GlobalContext.tsx';

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
    const [urls, setUrls] = useState<string[]>(['']);
    const [isScanning, setIsScanning] = useState(false);
    const [results, setResults] = useState<FileMetadata[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const { setCurrentPage } = useGlobalContext();
    const [driveFileStatuses, setDriveFileStatuses] = useState<
        Record<string, boolean>
    >({});

    const isThatDriveFile = async (fileId: string) => {
        const token = await invoke<string>('get_access_token');
        try {
            await invoke('get_parent_id', {
                token: token,
                fileId: fileId,
            });
            return true;
        } catch (err) {
            return false;
        }
    };

    useEffect(() => {
        const checkFiles = async () => {
            const statuses: Record<string, boolean> = {};

            await Promise.all(
                results.map(async (file) => {
                    statuses[file.id] = await isThatDriveFile(file.id);
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
        }).then((fn) => {
            unlistenFn = fn;
        });

        return () => {
            unlistenFn?.();
        };
    }, []);

    const addUrl = () => {
        setUrls([...urls, '']);
    };

    const removeUrl = (index: number) => {
        setUrls(urls.filter((_, i) => i !== index));
    };

    const updateUrl = (index: number, value: string) => {
        const newUrls = [...urls];
        newUrls[index] = value;
        setUrls(newUrls);
    };

    const extractFileId = (url: string): string | null => {
        const patterns = [
            /\/d\/([a-zA-Z0-9_-]+)/,
            /\/folders\/([a-zA-Z0-9_-]+)/,
            /id=([a-zA-Z0-9_-]+)/,
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        // Может это уже ID
        if (/^[a-zA-Z0-9_-]+$/.test(url.trim())) {
            return url.trim();
        }

        return null;
    };

    const handleScan = async () => {
        const validUrls = urls
            .map((url) => extractFileId(url))
            .filter((id): id is string => id !== null);

        if (validUrls.length === 0) {
            setLogs(['Нет валидных ссылок для сканирования']);
            return;
        }

        setIsScanning(true);
        setLogs([]);
        setResults([]);

        try {
            const metadata = await invoke<FileMetadata[]>('scan_files_direct', {
                fileIds: validUrls,
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
            const token = await invoke<string>('get_access_token');
            await invoke('remove_permission', {
                fileId,
                permissionId,
                token,
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
            const token = await invoke<string>('get_access_token');
            await invoke('copy_file_without_owner', {
                token,
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

    return (
        <Container maxWidth='lg'>
            <Card sx={{ p: 4, mt: 4 }}>
                <Typography
                    variant='h4'
                    component='h1'
                    sx={{ mb: 3, textAlign: 'center', fontWeight: 700 }}
                >
                    Прямое сканирование файлов
                </Typography>
                <Typography
                    variant='subtitle2'
                    sx={{ mb: 1, fontWeight: 500 }}
                >
                    Ссылки на файлы/папки
                </Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', mb: 2 }}>
                    {urls.map((url, index) => (
                        <Box
                            key={index}
                            sx={{ display: 'flex', gap: 1, mb: 1 }}
                        >
                            <TextField
                                fullWidth
                                size='small'
                                value={url}
                                onChange={(e) =>
                                    updateUrl(index, e.target.value)
                                }
                                placeholder='https://drive.google.com/... или ID файла'
                                disabled={isScanning}
                            />
                            {urls.length > 1 && (
                                <IconButton
                                    onClick={() => removeUrl(index)}
                                    disabled={isScanning}
                                    size='small'
                                >
                                    <DeleteIcon />
                                </IconButton>
                            )}
                        </Box>
                    ))}
                </Box>
                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                    <Button
                        variant='outlined'
                        startIcon={<AddIcon />}
                        onClick={addUrl}
                        disabled={isScanning}
                    >
                        Добавить ссылку
                    </Button>
                    <Button
                        variant='contained'
                        fullWidth
                        onClick={handleScan}
                        disabled={isScanning || urls.every((u) => !u.trim())}
                    >
                        {isScanning ? 'Сканирование...' : 'Сканировать'}
                    </Button>
                </Box>
                {logs.length > 0 && (
                    <>
                        <Typography
                            variant='subtitle2'
                            sx={{ mt: 2, mb: 1, fontWeight: 500 }}
                        >
                            Лог
                        </Typography>
                        <Box
                            component='pre'
                            sx={{
                                bgcolor: '#1e1e1e',
                                color: '#d4d4d4',
                                p: 2,
                                borderRadius: 1,
                                maxHeight: 120,
                                overflow: 'auto',
                                fontFamily: 'monospace',
                                fontSize: 13,
                                lineHeight: 1.5,
                                m: 0,
                                mb: 3,
                            }}
                        >
                            {logs.join('\n')}
                        </Box>
                    </>
                )}
                {results.length > 0 && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography
                            variant='h6'
                            sx={{ mb: 2, fontWeight: 600 }}
                        >
                            Результаты сканирования
                        </Typography>

                        {results.map((file) => {
                            const isDriveFile =
                                driveFileStatuses[file.id] ?? false;

                            return (
                                <Paper
                                    key={file.id}
                                    sx={{ p: 2, mb: 2 }}
                                >
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'flex-start',
                                            mb: 2,
                                        }}
                                    >
                                        <Box>
                                            <Typography
                                                variant='subtitle1'
                                                sx={{ fontWeight: 600 }}
                                            >
                                                {file.name}
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                sx={{ color: 'text.secondary' }}
                                            >
                                                Владелец: {file.owner}
                                            </Typography>
                                        </Box>{' '}
                                        <Tooltip
                                            title={
                                                !isDriveFile
                                                    ? 'Это не файл Google Drive'
                                                    : ''
                                            }
                                        >
                                            <span>
                                                <Button
                                                    variant='outlined'
                                                    size='small'
                                                    onClick={() =>
                                                        handleCopyWithoutOwner(
                                                            file
                                                        )
                                                    }
                                                    disabled={!isDriveFile}
                                                >
                                                    Сменить владельца
                                                </Button>
                                            </span>
                                        </Tooltip>
                                    </Box>

                                    <Typography
                                        variant='caption'
                                        sx={{
                                            display: 'block',
                                            mb: 1,
                                            fontWeight: 500,
                                        }}
                                    >
                                        Доступы ({file.permissions.length}):
                                    </Typography>

                                    {file.permissions.length === 0 ? (
                                        <Typography
                                            variant='body2'
                                            sx={{ color: 'text.secondary' }}
                                        >
                                            Нет дополнительных доступов
                                        </Typography>
                                    ) : (
                                        <List
                                            dense
                                            sx={{ p: 0 }}
                                        >
                                            {file.permissions.map((perm) => (
                                                <ListItem
                                                    key={perm.id}
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent:
                                                            'space-between',
                                                        p: 1,
                                                        bgcolor: 'action.hover',
                                                        borderRadius: 1,
                                                        mb: 0.5,
                                                    }}
                                                >
                                                    <Box>
                                                        <Typography variant='body2'>
                                                            {perm.displayName ||
                                                                perm.email}
                                                        </Typography>
                                                        <Typography
                                                            variant='caption'
                                                            sx={{
                                                                color: 'text.secondary',
                                                            }}
                                                        >
                                                            {perm.email}
                                                        </Typography>
                                                    </Box>
                                                    <Box
                                                        sx={{
                                                            display: 'flex',
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
                                                        />
                                                        {perm.role !==
                                                            'owner' && (
                                                            <IconButton
                                                                size='small'
                                                                onClick={() =>
                                                                    handleRemovePermission(
                                                                        file.id,
                                                                        perm.id
                                                                    )
                                                                }
                                                            >
                                                                <DeleteIcon fontSize='small' />
                                                            </IconButton>
                                                        )}
                                                    </Box>
                                                </ListItem>
                                            ))}
                                        </List>
                                    )}
                                </Paper>
                            );
                        })}
                    </>
                )}
                <Box
                    sx={{
                        mt: 3,
                        textAlign: 'center',
                        display: 'flex',
                        gap: 2,
                        justifyContent: 'center',
                    }}
                >
                    <Button
                        variant='text'
                        size='small'
                        onClick={() => setCurrentPage('main')}
                        sx={{ color: 'text.secondary' }}
                    >
                        ← Главная
                    </Button>
                </Box>
            </Card>
        </Container>
    );
};

export default DirectScan;

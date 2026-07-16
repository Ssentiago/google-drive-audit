import { useState, useEffect, useCallback } from 'react';
import {
    Alert,
    AlertTitle,
    Button,
    CircularProgress,
    Snackbar,
    Box,
    Typography,
    Chip,
    alpha,
} from '@mui/material';
import SystemUpdateIcon from '@mui/icons-material/SystemUpdate';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { invoke } from '@tauri-apps/api/core';

interface UpdateInfo {
    available: boolean;
    current_version: string;
    latest_version: string;
    download_url: string | null;
    asset_name: string | null;
    release_notes: string | null;
    published_at: string | null;
}

interface DownloadResult {
    path: string;
    already_existed: boolean;
}

interface UpdateBannerProps {
    autoCheck?: boolean;
    showButton?: boolean;
    compact?: boolean;
}

const UpdateBanner = ({
    autoCheck = false,
    showButton = true,
    compact = false,
}: UpdateBannerProps) => {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(
        null
    );
    const [error, setError] = useState<string | null>(null);
    const [showSuccess, setShowSuccess] = useState(false);

    const checkForUpdates = useCallback(async () => {
        setIsChecking(true);
        setError(null);
        try {
            const info = await invoke<UpdateInfo>('check_for_updates');
            setUpdateInfo(info);

            if (info.available && info.asset_name) {
                const downloaded = await invoke<boolean>('is_update_downloaded', {
                    assetName: info.asset_name,
                });
                if (downloaded) {
                    const downloadsDir = await invoke<string>('get_downloads_dir');
                    setDownloadResult({
                        path: `${downloadsDir}/${info.asset_name}`,
                        already_existed: true,
                    });
                }
            }
        } catch (e) {
            setError(`Ошибка проверки: ${e}`);
        } finally {
            setIsChecking(false);
        }
    }, []);

    const downloadUpdate = useCallback(async () => {
        if (!updateInfo?.download_url || !updateInfo?.asset_name) return;

        setIsDownloading(true);
        setError(null);
        try {
            const result = await invoke<DownloadResult>('download_update', {
                downloadUrl: updateInfo.download_url,
                assetName: updateInfo.asset_name,
            });
            setDownloadResult(result);
            setShowSuccess(true);
        } catch (e) {
            setError(`Ошибка скачивания: ${e}`);
        } finally {
            setIsDownloading(false);
        }
    }, [updateInfo]);

    useEffect(() => {
        if (autoCheck) {
            checkForUpdates();
        }
    }, [autoCheck, checkForUpdates]);

    if (compact) {
        return (
            <>
                {updateInfo?.available && !downloadResult && (
                    <Chip
                        icon={<SystemUpdateIcon />}
                        label={`v${updateInfo.latest_version}`}
                        onClick={checkForUpdates}
                        color="warning"
                        size="small"
                        sx={{ fontWeight: 600 }}
                    />
                )}
                {downloadResult && (
                    <Chip
                        icon={<CheckCircleIcon />}
                        label="Загружено"
                        color="success"
                        size="small"
                        sx={{ fontWeight: 600 }}
                    />
                )}
                {isChecking && (
                    <CircularProgress size={16} sx={{ ml: 1 }} />
                )}
                <Snackbar
                    open={showSuccess}
                    autoHideDuration={4000}
                    onClose={() => setShowSuccess(false)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                >
                    <Alert
                        severity="success"
                        onClose={() => setShowSuccess(false)}
                    >
                        Обновление загружено в папку Загрузки
                    </Alert>
                </Snackbar>
            </>
        );
    }

    return (
        <Box sx={{ mb: 2 }}>
            {showButton && !updateInfo && (
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={
                        isChecking ? (
                            <CircularProgress size={16} />
                        ) : (
                            <SystemUpdateIcon />
                        )
                    }
                    onClick={checkForUpdates}
                    disabled={isChecking}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    {isChecking ? 'Проверка...' : 'Проверить обновления'}
                </Button>
            )}

            {updateInfo && !updateInfo.available && !downloadResult && (
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                    У вас последняя версия (v{updateInfo.current_version})
                </Alert>
            )}

            {updateInfo?.available && !downloadResult && (
                <Alert
                    severity="warning"
                    action={
                        <Button
                            color="inherit"
                            size="small"
                            startIcon={
                                isDownloading ? (
                                    <CircularProgress size={16} />
                                ) : (
                                    <DownloadIcon />
                                )
                            }
                            onClick={downloadUpdate}
                            disabled={isDownloading}
                            sx={{ fontWeight: 600 }}
                        >
                            {isDownloading ? 'Загрузка...' : 'Скачать'}
                        </Button>
                    }
                    sx={{ borderRadius: 2 }}
                >
                    <AlertTitle>Доступно обновление</AlertTitle>
                    Версия {updateInfo.latest_version} (текущая:{' '}
                    {updateInfo.current_version})
                    {updateInfo.release_notes && (
                        <Typography
                            variant="caption"
                            display="block"
                            sx={{ mt: 1, opacity: 0.8 }}
                        >
                            {updateInfo.release_notes.slice(0, 200)}
                            {updateInfo.release_notes.length > 200 && '...'}
                        </Typography>
                    )}
                </Alert>
            )}

            {downloadResult && (
                <Alert
                    severity="success"
                    icon={<CheckCircleIcon />}
                    sx={{ borderRadius: 2 }}
                >
                    <AlertTitle>
                        {downloadResult.already_existed
                            ? 'Обновление уже загружено'
                            : 'Обновление загружено'}
                    </AlertTitle>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                        {downloadResult.path}
                    </Typography>
                </Alert>
            )}

            {error && (
                <Alert
                    severity="error"
                    onClose={() => setError(null)}
                    sx={{ borderRadius: 2 }}
                >
                    {error}
                </Alert>
            )}

            <Snackbar
                open={showSuccess}
                autoHideDuration={4000}
                onClose={() => setShowSuccess(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity="success"
                    onClose={() => setShowSuccess(false)}
                >
                    Обновление загружено в папку Загрузки
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default UpdateBanner;

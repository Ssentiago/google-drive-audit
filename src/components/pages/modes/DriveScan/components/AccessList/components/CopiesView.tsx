import React from 'react';
import { UndeletedOriginal } from '../../../../../../../core/ScanContext.tsx';
import { Box, Button, Card, Typography } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';

export const CopiesView: React.FC<{
    copies: UndeletedOriginal[];
    onProcess: (copyId: string, originalId: string) => void;
}> = ({ copies, onProcess }) => {
    if (copies.length === 0) {
        return (
            <Card sx={{ p: 4, textAlign: 'center' }}>
                <Typography
                    variant='h6'
                    sx={{ mb: 2, color: 'success.main' }}
                >
                    ✅ Все оригиналы убраны из папок
                </Typography>
                <Typography color='text.secondary'>
                    У всех ваших копий оригинальные файлы уже убраны из
                    родительских папок.
                </Typography>
            </Card>
        );
    }

    return (
        <Box>
            <Card
                sx={{
                    p: 3,
                    mb: 3,
                    bgcolor: 'warning.50',
                    borderLeft: '4px solid',
                    borderColor: 'warning.main',
                }}
            >
                <Typography
                    variant='h6'
                    sx={{ mb: 2, fontWeight: 600 }}
                >
                    ⚠️ Важно понимать
                </Typography>
                <Typography
                    variant='body2'
                    sx={{ mb: 1 }}
                >
                    • Оригинал будет <strong>убран из папки</strong>, но{' '}
                    <strong>НЕ удалён</strong>
                </Typography>
                <Typography
                    variant='body2'
                    sx={{ mb: 1 }}
                >
                    • Владелец файла продолжит видеть его в "Мой диск" → "Все
                    файлы"
                </Typography>
                <Typography variant='body2'>
                    • Из папки он исчезнет для всех, включая владельца
                </Typography>
            </Card>

            <Typography
                variant='h6'
                sx={{ mb: 2, fontWeight: 600 }}
            >
                📋 Наши копии с неубранными оригиналами ({copies.length})
            </Typography>

            {copies.map((copy) => {
                return (
                    <Card
                        key={copy.copyId}
                        sx={{ p: 3, mb: 2 }}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 2,
                                alignItems: 'start',
                            }}
                        >
                            <Box sx={{ flex: 1 }}>
                                <Typography
                                    variant='subtitle1'
                                    sx={{ fontWeight: 600, mb: 1 }}
                                >
                                    {copy.copyName}
                                </Typography>
                                <Typography
                                    variant='caption'
                                    color='text.secondary'
                                >
                                    {copy.path}
                                </Typography>
                            </Box>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button
                                    variant='outlined'
                                    size='small'
                                    onClick={async () =>
                                        await invoke('open_url', {
                                            url: copy.copyUrl,
                                        })
                                    }
                                >
                                    Открыть копию
                                </Button>
                                <Button
                                    variant='outlined'
                                    size='small'
                                    onClick={async () =>
                                        await invoke('open_url', {
                                            url: copy.originalUrl,
                                        })
                                    }
                                >
                                    Открыть оригинал
                                </Button>
                                <Button
                                    variant='contained'
                                    color='warning'
                                    size='small'
                                    onClick={() =>
                                        onProcess(copy.copyId, copy.originalId)
                                    }
                                >
                                    Убрать из папки
                                </Button>
                            </Box>
                        </Box>
                    </Card>
                );
            })}
        </Box>
    );
};

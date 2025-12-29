// ============ HEATMAP VIEW ============
import { Access } from '../../../../../../../core/ScanContext.tsx';
import React, { useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';

interface HeatmapFolder {
    path: string;
    count: number;
    owners: number;
    permissions: number;
    items: Access[];
}

export const HeatmapView: React.FC<{
    access: Access[];
    onSelectFolder: (items: Access[]) => void;
}> = ({ access, onSelectFolder }) => {
    const folders = useMemo(() => {
        const map = new Map<string, HeatmapFolder>();

        access.forEach((item) => {
            if (!map.has(item.path)) {
                map.set(item.path, {
                    path: item.path,
                    count: 0,
                    owners: 0,
                    permissions: 0,
                    items: [],
                });
            }
            const folder = map.get(item.path)!;
            folder.count++;
            folder.items.push(item);
            if (item.roleType === 'owner') folder.owners++;
            if (item.permissionId) folder.permissions++;
        });

        return Array.from(map.values()).sort((a, b) => {
            if (a.owners !== b.owners) return b.owners - a.owners;
            return b.count - a.count;
        });
    }, [access]);

    const maxCount = Math.max(...folders.map((f) => f.count));

    return (
        <Box>
            <Typography
                variant='h6'
                sx={{ mb: 2, fontWeight: 600 }}
            >
                🔥 Тепловая карта угроз
            </Typography>

            <Box
                sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    maxHeight: 600,
                    overflow: 'auto',
                }}
            >
                {folders.map((folder) => {
                    const intensity = (folder.count / maxCount) * 100;
                    const color =
                        folder.owners > 0
                            ? 'error'
                            : folder.permissions > 0
                              ? 'warning'
                              : 'info';

                    return (
                        <Box
                            key={folder.path}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                p: 2,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                cursor: 'pointer',
                                '&:hover': {
                                    bgcolor: 'action.hover',
                                },
                            }}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
                                    📁 {folder.path || 'Корень'}
                                </Typography>
                                <Box
                                    sx={{
                                        height: 24,
                                        bgcolor: 'grey.200',
                                        borderRadius: 1,
                                        overflow: 'hidden',
                                        position: 'relative',
                                    }}
                                >
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            bottom: 0,
                                            width: `${intensity}%`,
                                            bgcolor: `${color}.main`,
                                            transition: 'width 0.3s ease',
                                        }}
                                    />
                                    <Typography
                                        sx={{
                                            position: 'absolute',
                                            left: 8,
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color:
                                                intensity > 50
                                                    ? 'white'
                                                    : 'text.primary',
                                        }}
                                    >
                                        {folder.count} угроз
                                    </Typography>
                                </Box>
                            </Box>

                            <Box
                                sx={{ display: 'flex', gap: 1, flexShrink: 0 }}
                            >
                                {folder.owners > 0 && (
                                    <Box
                                        sx={{
                                            px: 1.5,
                                            py: 0.5,
                                            bgcolor: 'error.main',
                                            color: 'white',
                                            borderRadius: 1,
                                            fontSize: 12,
                                            fontWeight: 700,
                                        }}
                                    >
                                        👑 {folder.owners}
                                    </Box>
                                )}
                                {folder.permissions > 0 && (
                                    <Box
                                        sx={{
                                            px: 1.5,
                                            py: 0.5,
                                            bgcolor: 'warning.main',
                                            color: 'white',
                                            borderRadius: 1,
                                            fontSize: 12,
                                            fontWeight: 700,
                                        }}
                                    >
                                        🔓 {folder.permissions}
                                    </Box>
                                )}
                            </Box>

                            <Button
                                variant='contained'
                                size='small'
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectFolder(folder.items);
                                }}
                                sx={{ flexShrink: 0 }}
                            >
                                Выделить все
                            </Button>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};

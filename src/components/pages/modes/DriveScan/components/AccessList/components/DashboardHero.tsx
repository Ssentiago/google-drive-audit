import React, { useMemo } from 'react';
import { Access } from '../../../../../../../core/ScanContext.tsx';
import { Box, Card, Typography } from '@mui/material';

export interface ThreatStats {
    total: number;
    owners: number;
    permissions: number;
    folders: number;
    criticalPaths: Array<{ path: string; count: number }>;
}

const buildThreatStats = (access: Access[]): ThreatStats => {
    const folders = new Set(access.map((a) => a.path));
    const pathCounts = new Map<string, number>();

    access.forEach((a) => {
        pathCounts.set(a.path, (pathCounts.get(a.path) || 0) + 1);
    });

    const criticalPaths = Array.from(pathCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([path, count]) => ({ path, count }));

    return {
        total: access.length,
        owners: access.filter((a) => a.roleType === 'owner').length,
        permissions: access.filter((a) => a.permissionId).length,
        folders: folders.size,
        criticalPaths,
    };
};

const DashboardHero: React.FC<{
    access: Access[];
}> = ({ access }) => {
    const stats = useMemo(
        () => (access ? buildThreatStats(access) : null),
        [access]
    );
    return (
        <Box sx={{ mb: 4 }}>
            <Typography
                variant='h4'
                sx={{ mb: 3, fontWeight: 700, textAlign: 'center' }}
            >
                ⚠️ Найдено {stats.total} доступов
            </Typography>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 2,
                    mb: 3,
                }}
            >
                <Card
                    sx={{
                        p: 3,
                        bgcolor: 'error.50',
                        borderLeft: '4px solid',
                        borderColor: 'error.main',
                    }}
                >
                    <Typography
                        variant='h3'
                        sx={{ fontWeight: 700, color: 'error.main' }}
                    >
                        {stats.owners}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        👑 Владельцев
                    </Typography>
                </Card>

                <Card
                    sx={{
                        p: 3,
                        bgcolor: 'warning.50',
                        borderLeft: '4px solid',
                        borderColor: 'warning.main',
                    }}
                >
                    <Typography
                        variant='h3'
                        sx={{ fontWeight: 700, color: 'warning.main' }}
                    >
                        {stats.permissions}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        🔓 Доступов
                    </Typography>
                </Card>

                <Card
                    sx={{
                        p: 3,
                        bgcolor: 'info.50',
                        borderLeft: '4px solid',
                        borderColor: 'info.main',
                    }}
                >
                    <Typography
                        variant='h3'
                        sx={{ fontWeight: 700, color: 'info.main' }}
                    >
                        {stats.folders}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        📁 Папок скомпрометировано
                    </Typography>
                </Card>
            </Box>

            <Card sx={{ p: 3 }}>
                <Typography
                    variant='h6'
                    sx={{ mb: 2, fontWeight: 600 }}
                >
                    🔥 Топ-5 папок по угрозам
                </Typography>
                {stats.criticalPaths.map(({ path, count }) => {
                    const percentage = (count / stats.total) * 100;

                    return (
                        <Box
                            key={path}
                            sx={{ mb: 1.5 }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    mb: 0.5,
                                }}
                            >
                                <Typography
                                    variant='body2'
                                    sx={{ fontWeight: 600 }}
                                >
                                    {path || 'Корень'}
                                </Typography>
                                <Typography
                                    variant='body2'
                                    color='text.secondary'
                                >
                                    {count}
                                </Typography>
                            </Box>
                            <Box
                                sx={{
                                    height: 8,
                                    bgcolor: 'grey.200',
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                }}
                            >
                                <Box
                                    sx={{
                                        height: '100%',
                                        width: `${percentage}%`,
                                        bgcolor:
                                            percentage > 50
                                                ? 'error.main'
                                                : percentage > 25
                                                  ? 'warning.main'
                                                  : 'info.main',
                                        transition: 'width 0.3s ease',
                                    }}
                                />
                            </Box>
                        </Box>
                    );
                })}
            </Card>
        </Box>
    );
};

export default DashboardHero;

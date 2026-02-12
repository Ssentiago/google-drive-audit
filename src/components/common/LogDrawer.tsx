import React, { useRef, useEffect, useState } from 'react';
import {
    Drawer,
    Box,
    Typography,
    IconButton,
    Badge,
    Tooltip,
    alpha,
    Button,
    Chip,
} from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { AutoSizer, List } from 'react-virtualized';

interface LogDrawerProps {
    logs: string[];
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
    newLogsCount: number;
}

const LogDrawer: React.FC<LogDrawerProps> = ({
    logs,
    isOpen,
    onOpen,
    onClose,
    newLogsCount,
}) => {
    const listRef = useRef<any>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (listRef.current && autoScroll && logs.length > 0) {
            listRef.current.scrollToRow(logs.length - 1);
        }
    }, [logs, autoScroll]);

    const handleScroll = ({ scrollTop, clientHeight, scrollHeight }: any) => {
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        setAutoScroll(isAtBottom);
    };

    const handleCopyLogs = async () => {
        try {
            await navigator.clipboard.writeText(logs.join('\n'));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Ошибка копирования:', err);
        }
    };

    const scrollToBottom = () => {
        if (listRef.current) {
            listRef.current.scrollToRow(logs.length - 1);
            setAutoScroll(true);
        }
    };

    const getLogStats = () => {
        const success = logs.filter((l) => l.includes('✅')).length;
        const errors = logs.filter((l) => l.includes('❌')).length;
        const processing = logs.filter((l) => l.includes('🔄')).length;
        return { success, errors, processing };
    };

    const stats = getLogStats();

    const rowRenderer = ({ index, key, style }: any) => {
        const log = logs[index];
        let color = '#d4d4d4';
        if (log.includes('✅')) color = '#4caf50';
        if (log.includes('❌')) color = '#f44336';
        if (log.includes('🔄')) color = '#2196f3';
        if (log.includes('⚠️')) color = '#ff9800';

        return (
            <div
                key={key}
                style={{ ...style, color, paddingRight: 10 }}
            >
                {log}
            </div>
        );
    };

    return (
        <>
            <Tooltip title={`Открыть логи (${logs.length})`}>
                <IconButton
                    onClick={onOpen}
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

            <Drawer
                anchor='right'
                open={isOpen}
                onClose={onClose}
                PaperProps={{
                    sx: {
                        width: { xs: '100%', sm: 650 },
                        bgcolor: '#f5f5f5',
                    },
                }}
            >
                {/* Header */}
                <Box
                    sx={{
                        p: 2.5,
                        bgcolor: 'background.paper',
                        borderBottom: 1,
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                    }}
                >
                    <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
                    >
                        <TerminalIcon sx={{ color: 'primary.main' }} />
                        <Typography
                            variant='h6'
                            sx={{ fontWeight: 700 }}
                        >
                            Логи сканирования
                        </Typography>
                        <Chip
                            label={logs.length}
                            size='small'
                            sx={{ fontWeight: 600 }}
                        />
                    </Box>
                    <IconButton
                        onClick={onClose}
                        size='small'
                        sx={{
                            '&:hover': { bgcolor: alpha('#000', 0.05) },
                        }}
                    >
                        <CloseIcon />
                    </IconButton>
                </Box>

                {/* Stats */}
                {logs.length > 0 && (
                    <Box
                        sx={{
                            p: 2,
                            bgcolor: 'background.paper',
                            borderBottom: 1,
                            borderColor: 'divider',
                            display: 'flex',
                            gap: 1,
                            flexWrap: 'wrap',
                        }}
                    >
                        {stats.success > 0 && (
                            <Chip
                                label={`✅ ${stats.success}`}
                                size='small'
                                sx={{
                                    bgcolor: alpha('#4caf50', 0.1),
                                    color: '#2e7d32',
                                    fontWeight: 600,
                                }}
                            />
                        )}
                        {stats.errors > 0 && (
                            <Chip
                                label={`❌ ${stats.errors}`}
                                size='small'
                                sx={{
                                    bgcolor: alpha('#f44336', 0.1),
                                    color: '#c62828',
                                    fontWeight: 600,
                                }}
                            />
                        )}
                        {stats.processing > 0 && (
                            <Chip
                                label={`🔄 ${stats.processing}`}
                                size='small'
                                sx={{
                                    bgcolor: alpha('#2196f3', 0.1),
                                    color: '#1565c0',
                                    fontWeight: 600,
                                }}
                            />
                        )}
                    </Box>
                )}

                {/* Logs */}
                <Box sx={{ flex: 1, position: 'relative', p: 2 }}>
                    {logs.length === 0 ? (
                        <Box
                            sx={{
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'text.secondary',
                            }}
                        >
                            <Typography>Логи появятся здесь</Typography>
                        </Box>
                    ) : (
                        <>
                            <Box
                                sx={{
                                    bgcolor: '#1e1e1e',
                                    borderRadius: 2,
                                    p: 2.5,
                                    height: 'calc(100vh - 240px)',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                }}
                            >
                                <AutoSizer>
                                    {({ height, width }) => (
                                        <List
                                            ref={listRef}
                                            height={height}
                                            width={width}
                                            rowCount={logs.length}
                                            rowHeight={25}
                                            rowRenderer={rowRenderer}
                                            onScroll={handleScroll}
                                            style={{
                                                fontFamily: 'monospace',
                                                fontSize: 13,
                                                lineHeight: 1.6,
                                            }}
                                        />
                                    )}
                                </AutoSizer>
                            </Box>

                            {/* Scroll to bottom button */}
                            {!autoScroll && (
                                <Button
                                    onClick={scrollToBottom}
                                    variant='contained'
                                    size='small'
                                    startIcon={<KeyboardArrowDownIcon />}
                                    sx={{
                                        position: 'absolute',
                                        bottom: 24,
                                        right: 24,
                                        boxShadow: 3,
                                        textTransform: 'none',
                                        fontWeight: 600,
                                    }}
                                >
                                    К концу
                                </Button>
                            )}
                        </>
                    )}
                </Box>

                {/* Footer */}
                {logs.length > 0 && (
                    <Box
                        sx={{
                            p: 2,
                            bgcolor: 'background.paper',
                            borderTop: 1,
                            borderColor: 'divider',
                            display: 'flex',
                            gap: 1.5,
                        }}
                    >
                        <Button
                            onClick={handleCopyLogs}
                            startIcon={<ContentCopyIcon />}
                            variant='outlined'
                            size='small'
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                flex: 1,
                            }}
                        >
                            {copied ? 'Скопировано!' : 'Копировать'}
                        </Button>
                    </Box>
                )}
            </Drawer>
        </>
    );
};

export default LogDrawer;

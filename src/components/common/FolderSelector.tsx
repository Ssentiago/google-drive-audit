import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    alpha,
    Badge,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

export interface ScanHistoryEntry {
    timestamp: number;
    foldersCount: number;
    filesCount: number;
    durationSec: number;
    suspiciousCount: number;
}

export interface SavedFolder {
    id: string;
    name: string;
    savedAt: number;
    lastScan: ScanHistoryEntry | null;
    scanHistory: ScanHistoryEntry[];
}

interface FolderSelectorProps {
    folderId: string;
    isScanning: boolean;
    hasIdError: boolean;
    savedFolders: SavedFolder[];
    onFolderSelect: (folderId: string) => void;
    onFoldersUpdate: () => void;
}

export const FolderSelector: React.FC<FolderSelectorProps> = ({
    folderId,
    isScanning,
    hasIdError,
    savedFolders,
    onFolderSelect,
    onFoldersUpdate,
}) => {
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showFoldersDialog, setShowFoldersDialog] = useState(false);
    const [folderName, setFolderName] = useState('');

    const handleSaveFolder = async () => {
        if (!folderId.trim() || !folderName.trim()) return;

        try {
            await invoke('save_folder', {
                folderId: folderId.trim(),
                folderName: folderName.trim(),
            });
            onFoldersUpdate();
            setShowSaveDialog(false);
            setFolderName('');
        } catch (err) {
            console.error('Ошибка сохранения:', err);
        }
    };

    const handleSelectFolder = (folder: SavedFolder) => {
        onFolderSelect(folder.id);
        setShowFoldersDialog(false);
        onFoldersUpdate();
    };

    const handleRemoveFolder = async (
        folderId: string,
        e: React.MouseEvent
    ) => {
        e.stopPropagation();
        try {
            await invoke('remove_saved_folder', { folderId });
            onFoldersUpdate();
        } catch (err) {
            console.error('Ошибка удаления:', err);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const isFolderSaved = savedFolders.some((f) => f.id === folderId.trim());

    return (
        <>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                {/* Select Saved Folder Button */}
                <Tooltip title='Выбрать сохранённую папку'>
                    <IconButton
                        onClick={() => setShowFoldersDialog(true)}
                        disabled={isScanning}
                        sx={{
                            bgcolor: alpha('#1976d2', 0.1),
                            '&:hover': {
                                bgcolor: alpha('#1976d2', 0.2),
                            },
                            mt: 0.5,
                            height: 40,
                            width: 40,
                        }}
                    >
                        <Badge
                            badgeContent={savedFolders.length}
                            color='primary'
                        >
                            <FolderOpenIcon sx={{ fontSize: 20 }} />
                        </Badge>
                    </IconButton>
                </Tooltip>

                {/* Save Current Folder Button */}
                {folderId.trim() === '' ? (
                    <Tooltip title='Сохранить текущую папку (введите ID)'>
                        <span>
                            <IconButton
                                disabled
                                sx={{
                                    mt: 0.5,
                                    height: 40,
                                    width: 40,
                                }}
                            >
                                <BookmarkBorderIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                ) : isFolderSaved ? (
                    <Tooltip title='Папка уже сохранена'>
                        <IconButton
                            disabled
                            sx={{
                                color: 'success.main',
                                mt: 0.5,
                                height: 40,
                                width: 40,
                            }}
                        >
                            <CheckCircleIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
                ) : (
                    <Tooltip title='Сохранить текущую папку'>
                        <IconButton
                            onClick={() => setShowSaveDialog(true)}
                            disabled={isScanning || hasIdError}
                            sx={{
                                bgcolor: alpha('#1976d2', 0.1),
                                '&:hover': {
                                    bgcolor: alpha('#1976d2', 0.2),
                                },
                                mt: 0.5,
                                height: 40,
                                width: 40,
                            }}
                        >
                            <BookmarkAddIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
            {/* Save Folder Dialog */}
            <Dialog
                open={showSaveDialog}
                onClose={() => setShowSaveDialog(false)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle sx={{ fontWeight: 600 }}>
                    Сохранить папку
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label='Название'
                        placeholder='НИЦ Энерго'
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        sx={{ mt: 2 }}
                    />
                    <Typography
                        variant='caption'
                        sx={{
                            display: 'block',
                            mt: 1.5,
                            color: 'text.secondary',
                            fontFamily: 'monospace',
                        }}
                    >
                        ID: {folderId}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ p: 3, pt: 2 }}>
                    <Button
                        onClick={() => setShowSaveDialog(false)}
                        sx={{ textTransform: 'none' }}
                    >
                        Отмена
                    </Button>
                    <Button
                        onClick={handleSaveFolder}
                        variant='contained'
                        disabled={!folderName.trim()}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Сохранить
                    </Button>
                </DialogActions>
            </Dialog>
            {/* Saved Folders Dialog */}
            <Dialog
                open={showFoldersDialog}
                onClose={() => setShowFoldersDialog(false)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle sx={{ fontWeight: 600 }}>
                    Сохранённые папки
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                    {savedFolders.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center' }}>
                            <Typography color='text.secondary'>
                                Нет сохранённых папок
                            </Typography>
                        </Box>
                    ) : (
                        <List>
                            {savedFolders.map((folder, idx) => (
                                <Box key={folder.id}>
                                    <ListItem
                                        disablePadding
                                        secondaryAction={
                                            <IconButton
                                                edge='end'
                                                onClick={(e) =>
                                                    handleRemoveFolder(
                                                        folder.id,
                                                        e
                                                    )
                                                }
                                                sx={{ color: 'error.main' }}
                                            >
                                                <DeleteOutlineIcon />
                                            </IconButton>
                                        }
                                    >
                                        <ListItemButton
                                            onClick={() =>
                                                handleSelectFolder(folder)
                                            }
                                            sx={{
                                                '&:hover': {
                                                    bgcolor: alpha(
                                                        '#1976d2',
                                                        0.08
                                                    ),
                                                },
                                            }}
                                        >
                                            <ListItemText
                                                primary={
                                                    <Typography
                                                        sx={{ fontWeight: 600 }}
                                                    >
                                                        {folder.name}
                                                    </Typography>
                                                }
                                                secondary={
                                                    <>
                                                        <Typography
                                                            component='span'
                                                            variant='caption'
                                                            sx={{
                                                                display:
                                                                    'block',
                                                                fontFamily:
                                                                    'monospace',
                                                                mt: 0.5,
                                                            }}
                                                        >
                                                            {folder.id}
                                                        </Typography>
                                                        {folder.lastScan && (
                                                            <Typography
                                                                component='span'
                                                                variant='caption'
                                                                sx={{
                                                                    display:
                                                                        'block',
                                                                    mt: 0.5,
                                                                }}
                                                            >
                                                                Последнее
                                                                сканирование:{' '}
                                                                {formatDate(
                                                                    folder
                                                                        .lastScan
                                                                        .timestamp
                                                                )}{' '}
                                                                •{' '}
                                                                {
                                                                    folder
                                                                        .lastScan
                                                                        .suspiciousCount
                                                                }{' '}
                                                                доступов
                                                            </Typography>
                                                        )}
                                                    </>
                                                }
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                    {idx < savedFolders.length - 1 && (
                                        <Divider />
                                    )}
                                </Box>
                            ))}
                        </List>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 3, pt: 2 }}>
                    <Button
                        onClick={() => setShowFoldersDialog(false)}
                        sx={{ textTransform: 'none' }}
                    >
                        Закрыть
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, Chip, alpha } from '@mui/material';
import { listen } from '@tauri-apps/api/event';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import WarningIcon from '@mui/icons-material/Warning';

interface ProcessingStatus {
    nodeId: string;
    status: 'processing' | 'queued' | 'done';
}

interface TreeNode {
    id: string;
    name: string;
    itemType: 'folder' | 'file';
    parentId: string | null;
    hasSuspiciousAccess: boolean;
    suspiciousCount: number;
    path: string;
}

interface TreeNodeWithChildren extends TreeNode {
    children: TreeNodeWithChildren[];
    x: number;
    y: number;
    angle: number;
    collapsed: boolean;
    animProgress: number;
    processingStatus?: string;
}

const NODE_RADIUS = 8;
const ROOT_RADIUS = 16;
const BASE_RADIUS = 120;
const LEVEL_OFFSET = 100;
const LABEL_MIN_ZOOM = 0.8;

const DriveTree = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [nodes, setNodes] = useState<Map<string, TreeNode>>(new Map());
    const [hoveredNode, setHoveredNode] = useState<TreeNodeWithChildren | null>(
        null
    );
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [rootId, setRootId] = useState<string | null>(null);
    const [processingStatuses, setProcessingStatuses] = useState<
        Map<string, string>
    >(new Map());

    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [scale, setScale] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(
        new Set()
    );

    const animationFrame = useRef<number>(0);
    const nodeAnimations = useRef<Map<string, number>>(new Map());
    const lastDrawTime = useRef<number>(0);
    const treeCache = useRef<{
        tree: TreeNodeWithChildren | null;
        cacheKey: string;
    }>({ tree: null, cacheKey: '' });

    useEffect(() => {
        const unlistenTree = listen<TreeNode>('tree_node', (event) => {
            const node = event.payload;

            setNodes((prev) => {
                const updated = new Map(prev);
                updated.set(node.id, node);
                return updated;
            });

            nodeAnimations.current.set(node.id, 0);

            if (node.parentId === null) {
                setRootId(node.id);
            }
        });

        const unlistenStatus = listen<ProcessingStatus>(
            'processing_status',
            (event) => {
                const { nodeId, status } = event.payload;

                setProcessingStatuses((prev) => {
                    const updated = new Map(prev);
                    if (status === 'done') {
                        updated.delete(nodeId);
                    } else {
                        updated.set(nodeId, status);
                    }
                    return updated;
                });
            }
        );

        return () => {
            unlistenTree.then((fn) => fn());
            unlistenStatus.then((fn) => fn());
        };
    }, []);

    const buildTree = useCallback((): TreeNodeWithChildren | null => {
        if (!rootId) return null;

        const cacheKey = `${rootId}-${collapsedNodes.size}-${Array.from(collapsedNodes).join(',')}-${processingStatuses.size}`;

        if (treeCache.current.cacheKey === cacheKey && treeCache.current.tree) {
            return treeCache.current.tree;
        }

        let root: TreeNode | null = null;
        nodes.forEach((node) => {
            if (node.parentId === null) {
                root = node;
            }
        });

        if (!root) return null;

        const nodeMap = new Map<string, TreeNodeWithChildren>();

        nodes.forEach((node) => {
            nodeMap.set(node.id, {
                ...node,
                children: [],
                x: 0,
                y: 0,
                angle: 0,
                collapsed: collapsedNodes.has(node.id),
                animProgress: nodeAnimations.current.get(node.id) || 0,
                processingStatus: processingStatuses.get(node.id),
            });
        });

        nodes.forEach((node) => {
            if (node.parentId !== null) {
                const parent = nodeMap.get(node.parentId);
                const child = nodeMap.get(node.id);
                if (parent && child && !parent.collapsed) {
                    parent.children.push(child);
                }
            }
        });

        const tree = nodeMap.get(root.id) || null;
        treeCache.current = { tree, cacheKey };
        return tree;
    }, [rootId, nodes, collapsedNodes, processingStatuses]);

    const calculatePositions = useCallback(
        (
            node: TreeNodeWithChildren,
            centerX: number,
            centerY: number,
            startAngle: number,
            endAngle: number,
            level: number
        ) => {
            const progress = node.animProgress;
            node.x = centerX;
            node.y = centerY;

            if (node.children.length === 0 || node.collapsed) return;

            const radius = (BASE_RADIUS + level * LEVEL_OFFSET) * progress;
            const angleStep =
                (endAngle - startAngle) / Math.max(node.children.length, 1);

            node.children.forEach((child, i) => {
                const angle = startAngle + angleStep * i + angleStep / 2;
                child.angle = angle;
                child.x = centerX + radius * Math.cos(angle);
                child.y = centerY + radius * Math.sin(angle);

                const childStartAngle = angle - angleStep / 2;
                const childEndAngle = angle + angleStep / 2;

                calculatePositions(
                    child,
                    child.x,
                    child.y,
                    childStartAngle,
                    childEndAngle,
                    level + 1
                );
            });
        },
        []
    );

    const drawTree = useCallback(() => {
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

        ctx.clearRect(0, 0, rect.width, rect.height);

        const tree = buildTree();
        if (!tree) return;

        const centerX = rect.width / 2 + offset.x;
        const centerY = rect.height / 2 + offset.y;

        calculatePositions(tree, centerX, centerY, 0, Math.PI * 2, 0);

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);

        const drawNode = (
            node: TreeNodeWithChildren,
            isRoot: boolean = false
        ) => {
            const progress = node.animProgress;

            ctx.globalAlpha = progress;
            ctx.strokeStyle = '#424242';
            ctx.lineWidth = 1.5;

            node.children.forEach((child) => {
                ctx.beginPath();
                ctx.moveTo(node.x, node.y);
                ctx.lineTo(child.x, child.y);
                ctx.stroke();
            });

            ctx.globalAlpha = 1;

            const nodeRadius = isRoot ? ROOT_RADIUS : NODE_RADIUS;

            if (node.processingStatus === 'processing') {
                const pulse = Math.sin(Date.now() / 200) * 0.5 + 0.5;
                ctx.shadowColor = '#ff9800';
                ctx.shadowBlur = 20 + pulse * 10;

                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeRadius + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#ff9800';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            if (node.processingStatus === 'queued') {
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeRadius + 3, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 235, 59, 0.5)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeRadius * progress, 0, Math.PI * 2);

            if (isRoot) {
                ctx.fillStyle = '#9c27b0';
                ctx.shadowColor = '#9c27b0';
                ctx.shadowBlur = 20;
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#fff';
            } else if (node.hasSuspiciousAccess) {
                ctx.fillStyle = '#f44336';
                ctx.shadowColor = '#f44336';
                ctx.shadowBlur = 12;
            } else if (node.itemType === 'folder') {
                ctx.fillStyle = '#1976d2';
                ctx.shadowColor = '#1976d2';
                ctx.shadowBlur = 8;
            } else {
                ctx.fillStyle = '#757575';
                ctx.shadowBlur = 0;
            }

            ctx.fill();

            if (isRoot) {
                ctx.stroke();
            }

            ctx.shadowBlur = 0;

            if (hoveredNode?.id === node.id) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            if (node.collapsed && node.children.length > 0) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('+', node.x, node.y);
            }

            if (
                scale >= LABEL_MIN_ZOOM &&
                (node.itemType === 'folder' || isRoot)
            ) {
                ctx.fillStyle = '#fff';
                ctx.font = isRoot ? 'bold 14px sans-serif' : '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.shadowBlur = 4;

                const maxWidth = 100;
                let displayName = node.name;
                if (ctx.measureText(displayName).width > maxWidth) {
                    while (
                        ctx.measureText(displayName + '...').width > maxWidth &&
                        displayName.length > 0
                    ) {
                        displayName = displayName.slice(0, -1);
                    }
                    displayName += '...';
                }

                ctx.fillText(displayName, node.x, node.y + nodeRadius + 4);
                ctx.shadowBlur = 0;
            }

            node.children.forEach((child) => drawNode(child, false));
        };

        drawNode(tree, true);
        ctx.restore();
    }, [buildTree, calculatePositions, offset, scale, hoveredNode]);

    useEffect(() => {
        const animate = () => {
            const now = Date.now();
            const timeSinceLastDraw = now - lastDrawTime.current;

            if (timeSinceLastDraw < 33 && !isDragging) {
                animationFrame.current = requestAnimationFrame(animate);
                return;
            }

            let hasAnimations = false;
            nodeAnimations.current.forEach((progress, nodeId) => {
                if (progress < 1) {
                    nodeAnimations.current.set(
                        nodeId,
                        Math.min(1, progress + 0.05)
                    );
                    hasAnimations = true;
                }
            });

            const hasProcessing = processingStatuses.size > 0;

            if (hasAnimations || hasProcessing || isDragging) {
                drawTree();
                lastDrawTime.current = now;
                animationFrame.current = requestAnimationFrame(animate);
            }
        };

        animationFrame.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrame.current) {
                cancelAnimationFrame(animationFrame.current);
            }
        };
    }, [
        nodes,
        collapsedNodes,
        offset,
        scale,
        hoveredNode,
        processingStatuses,
        isDragging,
        drawTree,
    ]);

    const screenToCanvas = useCallback(
        (screenX: number, screenY: number) => {
            const canvas = canvasRef.current;
            if (!canvas) return { x: 0, y: 0 };

            const rect = canvas.getBoundingClientRect();
            const centerX = rect.width / 2 + offset.x;
            const centerY = rect.height / 2 + offset.y;

            const x = (screenX - rect.left - centerX) / scale + centerX;
            const y = (screenY - rect.top - centerY) / scale + centerY;

            return { x, y };
        },
        [offset, scale]
    );

    const handleMouseDown = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            setIsDragging(true);
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
        },
        [offset]
    );

    const handleMouseMove = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            if (isDragging) {
                setOffset({
                    x: e.clientX - dragStart.x,
                    y: e.clientY - dragStart.y,
                });
                return;
            }

            const canvas = canvasRef.current;
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const canvasCoords = screenToCanvas(e.clientX, e.clientY);

            setMousePos({ x: e.clientX, y: e.clientY });

            const tree = buildTree();
            if (!tree) return;

            const findNodeAt = (
                node: TreeNodeWithChildren,
                px: number,
                py: number,
                isRoot: boolean = false
            ): TreeNodeWithChildren | null => {
                const nodeRadius = isRoot ? ROOT_RADIUS : NODE_RADIUS;
                const dist = Math.sqrt((node.x - px) ** 2 + (node.y - py) ** 2);
                if (dist <= nodeRadius) return node;

                for (const child of node.children) {
                    const found = findNodeAt(child, px, py, false);
                    if (found) return found;
                }
                return null;
            };

            const centerX = rect.width / 2 + offset.x;
            const centerY = rect.height / 2 + offset.y;
            calculatePositions(tree, centerX, centerY, 0, Math.PI * 2, 0);

            const found = findNodeAt(
                tree,
                canvasCoords.x,
                canvasCoords.y,
                true
            );
            setHoveredNode(found);
        },
        [
            isDragging,
            dragStart,
            screenToCanvas,
            buildTree,
            calculatePositions,
            offset,
        ]
    );

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setHoveredNode(null);
        setIsDragging(false);
    }, []);

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            if (isDragging) return;

            if (hoveredNode && hoveredNode.itemType === 'folder') {
                setCollapsedNodes((prev) => {
                    const updated = new Set(prev);
                    if (updated.has(hoveredNode.id)) {
                        updated.delete(hoveredNode.id);
                    } else {
                        updated.add(hoveredNode.id);
                    }
                    return updated;
                });
            }
        },
        [isDragging, hoveredNode]
    );

    const handleWheel = useCallback(
        (e: React.WheelEvent<HTMLCanvasElement>) => {
            e.preventDefault();
            e.stopPropagation();

            const delta = -e.deltaY * 0.001;
            const newScale = Math.min(Math.max(0.5, scale + delta), 3);
            setScale(newScale);
        },
        [scale]
    );

    useEffect(() => {
        const handleResize = () => {
            treeCache.current = { tree: null, cacheKey: '' };
            drawTree();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [drawTree]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const preventScroll = (e: WheelEvent) => {
            e.preventDefault();
        };

        container.addEventListener('wheel', preventScroll, { passive: false });
        return () => container.removeEventListener('wheel', preventScroll);
    }, []);

    const stats = useMemo(() => {
        let totalFiles = 0;
        let totalFolders = 0;
        let suspiciousFiles = 0;

        nodes.forEach((node) => {
            if (node.itemType === 'file') {
                totalFiles++;
                if (node.hasSuspiciousAccess) suspiciousFiles++;
            } else {
                totalFolders++;
            }
        });

        return { totalFiles, totalFolders, suspiciousFiles };
    }, [nodes]);

    return (
        <Box
            ref={containerRef}
            sx={{
                position: 'relative',
                width: '100%',
                height: '100%',
                bgcolor: alpha('#000', 0.02),
                borderRadius: 1,
            }}
        >
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                onWheel={handleWheel}
                style={{
                    width: '100%',
                    height: '100%',
                    cursor: isDragging
                        ? 'grabbing'
                        : hoveredNode
                          ? 'pointer'
                          : 'grab',
                }}
            />

            {hoveredNode && !isDragging && (
                <Paper
                    elevation={16}
                    sx={{
                        position: 'fixed',
                        left: mousePos.x + 16,
                        top: mousePos.y + 16,
                        p: 2.5,
                        maxWidth: 340,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                        border: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            mb: 1.5,
                        }}
                    >
                        {hoveredNode.itemType === 'folder' ? (
                            <FolderIcon
                                sx={{ color: '#1976d2', fontSize: 24 }}
                            />
                        ) : (
                            <InsertDriveFileIcon
                                sx={{ color: 'text.secondary', fontSize: 24 }}
                            />
                        )}
                        <Typography
                            variant='subtitle2'
                            sx={{ fontWeight: 600, flex: 1 }}
                        >
                            {hoveredNode.name}
                        </Typography>
                    </Box>

                    {hoveredNode.path && (
                        <Typography
                            variant='caption'
                            sx={{
                                display: 'block',
                                mb: 1.5,
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                fontSize: 11,
                                bgcolor: alpha('#000', 0.05),
                                p: 1,
                                borderRadius: 0.5,
                            }}
                        >
                            {hoveredNode.path}
                        </Typography>
                    )}

                    <Box
                        sx={{
                            display: 'flex',
                            gap: 1,
                            flexWrap: 'wrap',
                            mb: hoveredNode.itemType === 'folder' ? 1.5 : 0,
                        }}
                    >
                        {hoveredNode.processingStatus && (
                            <Chip
                                label={
                                    hoveredNode.processingStatus ===
                                    'processing'
                                        ? 'Обрабатывается'
                                        : 'В очереди'
                                }
                                color={
                                    hoveredNode.processingStatus ===
                                    'processing'
                                        ? 'warning'
                                        : 'default'
                                }
                                size='small'
                                sx={{ fontWeight: 500 }}
                            />
                        )}

                        {hoveredNode.hasSuspiciousAccess && (
                            <Chip
                                icon={<WarningIcon sx={{ fontSize: 16 }} />}
                                label={`${hoveredNode.suspiciousCount} доступ${hoveredNode.suspiciousCount > 1 ? 'а' : ''}`}
                                color='error'
                                size='small'
                                sx={{ fontWeight: 500 }}
                            />
                        )}
                    </Box>

                    {hoveredNode.itemType === 'folder' && (
                        <Typography
                            variant='caption'
                            sx={{
                                display: 'block',
                                color: 'primary.main',
                                fontWeight: 500,
                                textAlign: 'center',
                                mt: 1,
                                pt: 1,
                                borderTop: 1,
                                borderColor: 'divider',
                            }}
                        >
                            Клик →{' '}
                            {collapsedNodes.has(hoveredNode.id)
                                ? 'развернуть'
                                : 'свернуть'}
                        </Typography>
                    )}
                </Paper>
            )}

            <Paper
                elevation={2}
                sx={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    p: 2,
                    minWidth: 200,
                    bgcolor: alpha('#fff', 0.95),
                    backdropFilter: 'blur(8px)',
                }}
            >
                <Typography
                    variant='caption'
                    sx={{
                        display: 'block',
                        color: 'text.secondary',
                        mb: 1,
                        fontWeight: 600,
                    }}
                >
                    Статистика
                </Typography>
                <Box
                    sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
                >
                    <Typography variant='body2'>
                        <strong>{stats.totalFolders}</strong> папок
                    </Typography>
                    <Typography variant='body2'>
                        <strong>{stats.totalFiles}</strong> файлов
                    </Typography>
                    {stats.suspiciousFiles > 0 && (
                        <Typography
                            variant='body2'
                            sx={{ color: 'error.main', fontWeight: 500 }}
                        >
                            <WarningIcon
                                sx={{
                                    fontSize: 14,
                                    mr: 0.5,
                                    verticalAlign: 'middle',
                                }}
                            />
                            <strong>{stats.suspiciousFiles}</strong>{' '}
                            подозрительных
                        </Typography>
                    )}
                </Box>
            </Paper>

            <Paper
                elevation={2}
                sx={{
                    position: 'absolute',
                    bottom: 16,
                    right: 16,
                    p: 2,
                    bgcolor: alpha('#fff', 0.95),
                    backdropFilter: 'blur(8px)',
                }}
            >
                <Typography
                    variant='caption'
                    sx={{
                        display: 'block',
                        color: 'text.secondary',
                        mb: 1.5,
                        fontWeight: 600,
                    }}
                >
                    Zoom: {(scale * 100).toFixed(0)}%
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                            sx={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                bgcolor: '#9c27b0',
                                boxShadow: `0 0 8px ${alpha('#9c27b0', 0.5)}`,
                            }}
                        />
                        <Typography
                            variant='caption'
                            sx={{ fontWeight: 500 }}
                        >
                            ROOT
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                            sx={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                bgcolor: '#1976d2',
                                boxShadow: `0 0 6px ${alpha('#1976d2', 0.4)}`,
                            }}
                        />
                        <Typography variant='caption'>Папки</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                            sx={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                bgcolor: '#f44336',
                                boxShadow: `0 0 8px ${alpha('#f44336', 0.5)}`,
                            }}
                        />
                        <Typography
                            variant='caption'
                            sx={{ color: 'error.main', fontWeight: 500 }}
                        >
                            Подозрительные
                        </Typography>
                    </Box>
                </Box>
            </Paper>
        </Box>
    );
};

export default DriveTree;

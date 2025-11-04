import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

type GlobalContextProps = {
    currentPage: string;
    setCurrentPage: (page: string) => void;
};

const GlobalContext = createContext<GlobalContextProps | undefined>(undefined);

export const GlobalProvider = ({ children }: { children: React.ReactNode }) => {
    const [currentPage, setCurrentPage] = useState<string>('/');

    const changePage = useCallback((page: string) => {
        setCurrentPage(page);
    }, []);

    const contextValue = useMemo(
        () => ({
            currentPage,
            setCurrentPage: changePage,
        }),
        [currentPage, changePage]
    );

    return (
        <GlobalContext.Provider value={contextValue}>
            {children}
        </GlobalContext.Provider>
    );
};

export const useGlobalContext = (): GlobalContextProps => {
    const context = useContext(GlobalContext);
    if (context === undefined) {
        throw new Error('useGlobalContext must be used within a GlobalProvider');
    }
    return context;
};

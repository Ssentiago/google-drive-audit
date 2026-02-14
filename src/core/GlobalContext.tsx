import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
} from 'react';

type GlobalContextProps = {
    currentPage: string;
    setCurrentPage: (page: string) => void;
    userEmail: string;
    setUserEmail: (userEmail: string) => void;
};

const GlobalContext = createContext<GlobalContextProps | undefined>(undefined);

export const GlobalProvider = ({ children }: { children: React.ReactNode }) => {
    const [currentPage, setCurrentPage] = useState<string>('/');
    const [authenticatedUserEmail, setAuthenticatedUserEmail] =
        useState<string>('');

    const changePage = useCallback((page: string) => {
        setCurrentPage(page);
    }, []);

    const setUserEmail = useCallback((userEmail: string) => {
        setAuthenticatedUserEmail(userEmail);
    }, []);

    const contextValue = useMemo(
        () => ({
            currentPage,
            setCurrentPage: changePage,
            userEmail: authenticatedUserEmail,
            setUserEmail: setUserEmail,
        }),
        [currentPage, changePage, authenticatedUserEmail, setUserEmail]
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
        throw new Error(
            'useGlobalContext must be used within a GlobalProvider'
        );
    }
    return context;
};

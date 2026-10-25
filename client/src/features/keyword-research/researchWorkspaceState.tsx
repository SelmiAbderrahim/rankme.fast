import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

interface ResearchWorkspaceStateValue {
  chips: string[];
  setChips: Dispatch<SetStateAction<string[]>>;
}

/**
 * Keeps the research form's keyword chips alive while the workspace switches
 * tabs: Radix unmounts the research panel when another tab opens, so without
 * this the typed keywords would be lost on every tab change.
 */
const ResearchWorkspaceStateContext = createContext<ResearchWorkspaceStateValue | null>(null);

export const ResearchWorkspaceStateProvider = ({
  initialChips,
  children,
}: {
  initialChips: string[];
  children: ReactNode;
}) => {
  const [chips, setChips] = useState(initialChips);
  return (
    <ResearchWorkspaceStateContext.Provider value={{ chips, setChips }}>
      {children}
    </ResearchWorkspaceStateContext.Provider>
  );
};

/** `null` outside the workspace (the site-embedded panel keeps its own chips). */
export const useResearchWorkspaceState = (): ResearchWorkspaceStateValue | null =>
  useContext(ResearchWorkspaceStateContext);

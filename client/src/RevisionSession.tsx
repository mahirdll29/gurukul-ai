import { createContext, useContext, useState, type ReactNode } from 'react';

type ScheduledReview = { id: string; quizFileId: string; question: string; dueAt: string };
type RevisionSession = {
  upcoming: ScheduledReview[];
  remember: (review: ScheduledReview) => void;
  forgetQuiz: (fileId: string) => void;
};

const Context = createContext<RevisionSession | null>(null);

export function RevisionSessionProvider({children}: {children: ReactNode}) {
  const [upcoming, setUpcoming] = useState<ScheduledReview[]>([]);

  function remember(review: ScheduledReview) {
    if (!Number.isFinite(Date.parse(review.dueAt))) return;
    setUpcoming(previous => [
      ...previous.filter(item => item.id !== review.id && Date.parse(item.dueAt) > Date.now()),
      review,
    ].sort((a,b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)));
  }

  // Retaking a quiz can reschedule its questions without returning their new dates.
  function forgetQuiz(fileId: string) {
    setUpcoming(previous => previous.filter(item => item.quizFileId !== fileId));
  }

  return <Context.Provider value={{upcoming, remember, forgetQuiz}}>{children}</Context.Provider>;
}

export function useRevisionSession() {
  const session = useContext(Context);
  if (!session) throw new Error('Revision session requires a signed-in workspace.');
  return session;
}

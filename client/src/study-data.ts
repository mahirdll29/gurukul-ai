import { useEffect, useState } from 'react';
import { request } from './api';

export type ReadingEntry = { id: string; locator?: string };
export type Course = { id: string; name: string; code: string; description?: string; role: string; student_count: number };
export type Attempt = { id: string; quiz_file_id: string; quiz_name: string; created_at: string; score: number; total: number };
export type Review = { id: string; quizName: string; question: string; box: number; dueAt: string };
export type LibraryFile = { id: string; name: string; format: string; course_code?: string; status: string; retracted_at?: string };
export type Analytics = {
  activity: {day:string; count:number}[];
  mostCitedFiles: {file_id:string; file_name:string; citations:number}[];
  mostCitedUnits: {unit_id:string; file_id:string; file_name:string; locator:string; citations:number}[];
  topicsWithheld:boolean; message:string; topics:{term:string; count:number}[];
};
export type Material = { id:string; versions: {id:string; status:string; job_status?:string}[]; current_version_id?:string };

type Result<T> = {data?: T; error?: string};
export function useStudyResource<T>(path: string, token: string, poll = false): Result<T> {
  const [result, setResult] = useState<Result<T> & {path:string; token:string}>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const data:T = await request(path, token, {signal:controller.signal});
        if (!controller.signal.aborted) setResult({path, token, data});
      } catch (error) {
        if (!controller.signal.aborted) setResult({path, token, error:error instanceof Error ? error.message : 'Unable to load data.'});
      } finally {
        if (poll && !controller.signal.aborted) timer = window.setTimeout(loadWhenVisible, 10000);
      }
    }
    function loadWhenVisible() {
      if (document.visibilityState === 'visible') void load();
      else timer = window.setTimeout(loadWhenVisible, 10000);
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [path, token, poll]);
  return result?.path === path && result.token === token ? result : {};
}

export const shortDate = (value:string | Date) => new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});
export const dayKey = (date:Date) => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
export const documentUrl = (id:string, locator?:string) => '/files/'+encodeURIComponent(id)+(locator ? '?unit='+encodeURIComponent(locator) : '');


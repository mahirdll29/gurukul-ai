const API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/api' : `${window.location.origin}/api`)).replace(/\/$/, '');

export async function request(path: string, token: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`Cannot reach the Gurukul-AI API at ${API}. Check that the server is running.`);
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (response.status !== 204 && !contentType.includes('application/json'))
    throw new Error(`The server at ${API} did not return API JSON.`);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Request failed (HTTP ${response.status}).`;
    throw new Error(response.status >= 500 && data?.error?.requestId ? `${message} (reference ${data.error.requestId})` : message);
  }
  return data;
}

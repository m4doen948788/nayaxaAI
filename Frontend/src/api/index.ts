import axios from 'axios';

const API_BASE_URL = 'http://localhost:6001/api/nayaxa';

export const createNayaxaApi = (apiKey: string) => {
  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  return {
    getDashboardInsights: async (instansi_id?: number, profil_id?: number) => {
      const res = await client.get('/dashboard-insights', { params: { instansi_id, profil_id } });
      return res.data;
    },
    getSessions: async (user_id: number) => {
      const res = await client.get('/sessions', { params: { user_id } });
      return res.data;
    },
    getHistoryBySession: async (session_id: string) => {
      const res = await client.get(`/history/${session_id}`);
      return res.data;
    },
    chat: async (data: any) => {
      const res = await client.post('/chat', data);
      return res.data;
    },
    // SSE Streaming - Standalone only (widget uses /chat above)
    chatStream: (data: any, onStep: (step: {icon: string, label: string}) => void, signal?: AbortSignal): Promise<{text: string, brain_used: string, session_id: string}> => {
      return new Promise(async (resolve, reject) => {
        try {
          const response = await fetch(`${API_BASE_URL}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify(data),
            signal,
          });
          if (!response.body) return reject(new Error('No stream body'));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              const lines = part.trim().split('\n');
              let eventType = '';
              let dataLine = '';
              for (const line of lines) {
                if (line.startsWith('event:')) eventType = line.slice(6).trim();
                if (line.startsWith('data:')) dataLine = line.slice(5).trim();
              }
              if (!dataLine) continue;
              try {
                const parsed = JSON.parse(dataLine);
                if (eventType === 'step') { onStep(parsed); }
                else if (eventType === 'done') { resolve(parsed); return; }
                else if (eventType === 'error') { reject(new Error(parsed.message)); return; }
              } catch (_) {}
            }
          }
        } catch (err: any) { reject(err); }
      });
    },
    deleteSession: async (session_id: string) => {
      const res = await client.delete(`/session/${session_id}`);
      return res.data;
    },
    togglePinSession: async (session_id: string, user_id: number, pin: boolean) => {
      const res = await client.post(`/session/${session_id}/pin`, { user_id, pin });
      return res.data;
    },
    getKnowledge: async () => {
      const res = await client.get('/knowledge');
      return res.data;
    },
    createKnowledge: async (data: any) => {
      const res = await client.post('/knowledge', data);
      return res.data;
    },
    updateKnowledge: async (id: number, data: any) => {
      const res = await client.put(`/knowledge/${id}`, data);
      return res.data;
    },
    deleteKnowledge: async (id: number) => {
      const res = await client.delete(`/knowledge/${id}`);
      return res.data;
    },
    getProposal: async (id: string) => {
      const res = await client.get(`/proposals/${id}`);
      return res.data;
    },
    applyProposal: async (id: string) => {
      const res = await client.post(`/proposals/${id}/apply`);
      return res.data;
    },
    rejectProposal: async (id: string) => {
      const res = await client.post(`/proposals/${id}/reject`);
      return res.data;
    },
  };
};

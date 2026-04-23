import axios from 'axios';

export const createNayaxaApi = (baseUrl: string, apiKey: string) => {
  const instance = axios.create({
    baseURL: baseUrl,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });

  return {
    getDashboardInsights: (params: { instansi_id?: number, profil_id?: number }) => 
      instance.get('/dashboard-insights', { params }).then(r => r.data),
    getSessions: (user_id: number) => 
      instance.get('/sessions', { params: { user_id } }).then(r => r.data),
    getHistoryBySession: (sessionId: string) => 
      instance.get(`/history/${sessionId}`).then(r => r.data),
    getProactiveInsight: (params: { current_page: string, instansi_id?: number }) =>
      instance.get('/proactive-insight', { params }).then(r => r.data),
    deleteSession: (sessionId: string) => 
      instance.delete(`/session/${sessionId}`).then(r => r.data),
    chat: (data: any) => 
      instance.post('/chat', data).then(r => r.data),
    chatStream: (data: any, onMessage: (event: string, data: any) => void) => {
      const controller = new AbortController();
      fetch(`${baseUrl}/chatStream`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      }).then(response => {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        let buffer = ""; 
        function read() {
          reader?.read().then(({ done, value }) => {
            if (done) return;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            lines.forEach(line => {
              if (line.startsWith('data: ')) {
                try {
                  const payload = JSON.parse(line.substring(6));
                  onMessage(payload.event || 'message', payload.data);
                } catch (e) {}
              }
            });
            read();
          });
        }
        read();
      });
      return () => controller.abort();
    }
  };
};

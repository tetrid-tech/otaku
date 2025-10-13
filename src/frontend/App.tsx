import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { elizaClient } from './lib/elizaClient';
import { socketManager } from './lib/socketManager';
import Chat from './components/Chat.tsx';

const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000';

// Generate a proper UUID for the user (required by server validation)
// The server expects senderId/entityId to be a valid UUID format
function getUserId(): string {
  const existingId = localStorage.getItem('eliza-user-id');
  if (existingId) {
    return existingId;
  }
  
  // Generate a valid UUID using the same method as the official client
  const userId = crypto.randomUUID();
  localStorage.setItem('eliza-user-id', userId);
  return userId;
}

const USER_ID = getUserId();

function App() {
  const [connected, setConnected] = useState(false);

  // Fetch the agent list first to get the ID
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const result = await elizaClient.agents.listAgents();
      return result.agents;
    },
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  const agentId = agentsData?.[0]?.id;

  // Fetch full agent details (including settings with avatar)
  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      if (!agentId) return null;
      return await elizaClient.agents.getAgent(agentId);
    },
    enabled: !!agentId, // Only fetch when we have an agent ID
    refetchInterval: 10000,
  });

  // Connect to socket
  useEffect(() => {
    const socket = socketManager.connect(USER_ID);
    
    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
    });

    return () => {
      socketManager.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {agent?.settings?.avatar ? (
                <img 
                  src={agent.settings.avatar as string} 
                  alt={agent.name}
                  className="w-10 h-10 rounded-lg object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xl font-bold">
                    {agent?.name?.charAt(0).toUpperCase() || 'E'}
                  </span>
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {agent?.name || 'Loading...'}
                </h1>
                <p className="text-sm text-gray-500">Powered by ElizaOS</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-600">
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-[calc(100vh-200px)]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading agent...</p>
            </div>
          </div>
        ) : agent ? (
          <Chat
            agent={agent}
            userId={USER_ID}
            serverId={DEFAULT_SERVER_ID}
          />
        ) : (
          <div className="flex items-center justify-center h-[calc(100vh-200px)]">
            <div className="text-center">
              <p className="text-xl text-gray-600">No agent available</p>
              <p className="text-sm text-gray-500 mt-2">Please start the server with an agent configured.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;


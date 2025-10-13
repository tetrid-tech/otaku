import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { elizaClient } from '../lib/elizaClient';
import { socketManager } from '../lib/socketManager';
import type { UUID, Agent } from '@elizaos/core';

interface Message {
  id: string;
  content: string;
  authorId: string;
  createdAt: number; // Timestamp in milliseconds
  isAgent: boolean;
  senderName?: string;
}

interface ChatProps {
  agent: Agent;
  userId: string;
  serverId: string;
}

export default function Chat({ agent, userId, serverId }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [channels, setChannels] = useState<Array<{ 
    id: string; 
    name: string; 
    createdAt?: number;
    lastMessageAt?: number;
  }>>([]);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);
  const queryClient = useQueryClient();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load all DM channels for this agent
  useEffect(() => {
    async function loadChannels() {
      setIsLoadingChannels(true);
      try {
        console.log('📂 Loading all DM channels for agent:', agent.id);
        console.log('👤 User ID:', userId);
        const response = await elizaClient.messaging.getServerChannels(serverId as UUID);
        console.log(`📊 Total channels from server: ${response.channels.length}`);
        
        // Filter for DM channels with this agent
        const dmChannels = await Promise.all(
          response.channels
            .filter((ch: any) => {
              // Check if it's a DM channel
              if (ch.type !== 'DM') return false;
              
              // Check participants in metadata
              const participants = ch.metadata?.participantCentralUserIds;
              if (participants && Array.isArray(participants)) {
                return participants.includes(agent.id) && participants.includes(userId);
              }
              
              // Fallback: check if it's marked as a DM for this agent
              const isForAgent = ch.metadata?.forAgent === agent.id || ch.metadata?.agentId === agent.id;
              const isForUser = ch.metadata?.user1 === userId || ch.metadata?.user2 === userId;
              
              return isForAgent && isForUser;
            })
            .map(async (ch: any) => {
              // Get channel creation time
              let createdAt = 0;
              if (ch.createdAt instanceof Date) {
                createdAt = ch.createdAt.getTime();
              } else if (typeof ch.createdAt === 'number') {
                createdAt = ch.createdAt;
              } else if (typeof ch.createdAt === 'string') {
                createdAt = Date.parse(ch.createdAt);
              } else if (ch.metadata?.createdAt) {
                // Try metadata.createdAt as fallback
                if (typeof ch.metadata.createdAt === 'string') {
                  createdAt = Date.parse(ch.metadata.createdAt);
                } else if (typeof ch.metadata.createdAt === 'number') {
                  createdAt = ch.metadata.createdAt;
                }
              }

              // Get the last message timestamp for display
              let lastMessageAt = 0;
              try {
                const msgs = await elizaClient.messaging.getChannelMessages(ch.id, { limit: 1 });
                if (msgs.messages.length > 0) {
                  const msg = msgs.messages[0];
                  if (msg.createdAt instanceof Date) {
                    lastMessageAt = msg.createdAt.getTime();
                  } else if (typeof msg.createdAt === 'number') {
                    lastMessageAt = msg.createdAt;
                  } else if (typeof msg.createdAt === 'string') {
                    lastMessageAt = Date.parse(msg.createdAt);
                  }
                }
              } catch (err) {
                console.warn(`Could not load last message for channel ${ch.id}`);
              }
              
              return {
                id: ch.id,
                name: ch.name || `Chat ${ch.id.substring(0, 8)}`,
                createdAt: createdAt || Date.now(), // Fallback to now if no creation time
                lastMessageAt,
              };
            })
        );

        // Sort by creation time - most recent (latest created) first
        const sortedChannels = dmChannels.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        setChannels(sortedChannels);
        console.log(`✅ Loaded ${sortedChannels.length} DM channels (sorted by creation time)`);
        sortedChannels.forEach((ch, i) => {
          const createdDate = ch.createdAt ? new Date(ch.createdAt).toLocaleString() : 'Unknown';
          console.log(`  ${i + 1}. ${ch.name} (${ch.id.substring(0, 8)}...) - Created: ${createdDate}`);
        });
      } catch (error: any) {
        console.warn('⚠️ Could not load channels:', error.message);
      } finally {
        setIsLoadingChannels(false);
      }
    }

    loadChannels();
  }, [agent.id, userId, serverId]);

  // Initialize channel after channels are loaded
  useEffect(() => {
    async function initChannel() {
      // Wait for channels to finish loading
      if (isLoadingChannels) {
        console.log('⏳ Waiting for channels to load...');
        return;
      }

      // Prevent duplicate initialization
      if (hasInitialized.current) {
        console.log('✓ Already initialized');
        return;
      }

      hasInitialized.current = true;

      try {
        console.log('🔍 Initializing DM channel for agent:', agent.id);
        console.log('👤 User ID:', userId);
        console.log('🌐 Server ID:', serverId);
        console.log(`📊 Found ${channels.length} existing channels`);
        
        let finalChannelId: string;

        // If we have existing channels, use the most recent one (first in sorted list)
        if (channels.length > 0) {
          finalChannelId = channels[0].id;
          console.log('✅ Using most recent channel:', finalChannelId, '-', channels[0].name);
        } else {
          // No existing channels, create a new one using getOrCreateDmChannel
          console.log('📞 No existing channels, creating new one...');
          const channel = await elizaClient.messaging.getOrCreateDmChannel({
            participantIds: [userId as UUID, agent.id as UUID],
          });
          finalChannelId = channel.id;
          console.log('✅ New channel created:', finalChannelId);
          
          // Add to channels list
          const now = Date.now();
          setChannels([{ 
            id: channel.id, 
            name: channel.name, 
            createdAt: now,
            lastMessageAt: 0 
          }]);
        }
        
        setChannelId(finalChannelId);

        // Fetch existing messages (if any)
        try {
          console.log('📨 Fetching message history...');
          const messagesResponse = await elizaClient.messaging.getChannelMessages(finalChannelId as UUID, {
            limit: 50,
          });

          const formattedMessages: Message[] = messagesResponse.messages.map((msg) => {
            // Convert createdAt to timestamp (milliseconds)
            let timestamp: number;
            if (msg.createdAt instanceof Date) {
              timestamp = msg.createdAt.getTime();
            } else if (typeof msg.createdAt === 'number') {
              timestamp = msg.createdAt;
            } else if (typeof msg.createdAt === 'string') {
              timestamp = Date.parse(msg.createdAt);
            } else {
              timestamp = Date.now();
            }

            return {
              id: msg.id,
              content: msg.content,
              authorId: msg.authorId,
              createdAt: timestamp,
              isAgent: msg.authorId === agent.id,
              senderName: msg.metadata?.authorDisplayName || (msg.authorId === agent.id ? agent.name : 'User'),
            };
          });

          // Sort messages by timestamp (oldest first)
          const sortedMessages = formattedMessages.sort((a, b) => a.createdAt - b.createdAt);
          
          setMessages(sortedMessages);
          console.log(`✅ Loaded ${sortedMessages.length} messages in chronological order`);
        } catch (messagesError: any) {
          console.warn('⚠️ Could not fetch message history:', messagesError.message);
          // Continue anyway - channel is set up for new messages
        }

        // Join channel for real-time updates
        console.log('🔌 Joining socket channel...');
        socketManager.joinChannel(finalChannelId);
        console.log('✅ Channel initialization complete!');
      } catch (error: any) {
        console.error('❌ Failed to initialize channel:', error);
        // Show error to user
        alert(`Failed to initialize chat: ${error.message || 'Unknown error'}\n\nCheck console for details.`);
      }
    }

    initChannel();

    return () => {
      if (channelId) {
        socketManager.leaveChannel(channelId);
      }
    };
  }, [agent.id, userId, serverId, agent.name, isLoadingChannels, channels]);

  // Listen for new messages
  useEffect(() => {
    if (!channelId) return undefined;

    const unsubscribe = socketManager.onMessage((data) => {
      if (data.channelId !== channelId && data.roomId !== channelId) return;

      // Generate a proper UUID if the message doesn't have an ID
      // Using crypto.randomUUID() like the official client's randomUUID() function
      const messageId = data.id || crypto.randomUUID();
      
      const newMessage: Message = {
        id: messageId,
        content: data.text || data.message,
        authorId: data.senderId,
        createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.parse(data.createdAt as string),
        isAgent: data.senderId === agent.id,
        senderName: data.senderName || (data.senderId === agent.id ? agent.name : 'User'),
      };

      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === newMessage.id)) {
          return prev;
        }
        // Add new message and sort by timestamp to maintain chronological order
        const updated = [...prev, newMessage];
        return updated.sort((a, b) => a.createdAt - b.createdAt);
      });

      // Stop typing indicator
      if (newMessage.isAgent) {
        setIsTyping(false);
      }
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [channelId, agent.id, agent.name]);

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!channelId) throw new Error('Channel not initialized');
      
      // Show typing indicator for agent
      setIsTyping(true);
      
      // Send via socket
      socketManager.sendMessage(channelId, message, serverId, {
        userId,
        isDm: true,
        targetUserId: agent.id,
      });
    },
    onError: (error) => {
      console.error('Failed to send message:', error);
      setIsTyping(false);
    },
  });

  const handleSendMessage = () => {
    if (!inputText.trim() || !channelId) return;

    sendMessageMutation.mutate(inputText);
    setInputText('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Create a new chat channel
  const handleCreateNewChat = async () => {
    if (isCreatingChannel) return;
    
    setIsCreatingChannel(true);
    try {
      console.log('➕ Creating new chat channel...');
      const timestamp = new Date().toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      });
      const channelName = `Chat - ${timestamp}`;
      
      const now = Date.now();
      const newChannel = await elizaClient.messaging.createGroupChannel({
        name: channelName,
        participantIds: [userId as UUID, agent.id as UUID],
        metadata: {
          type: 'DM',
          isDm: true,
          user1: userId,
          user2: agent.id,
          forAgent: agent.id,
          createdAt: new Date(now).toISOString(),
        },
      });

      // Add to channels list at the beginning (most recent)
      setChannels(prev => [
        { 
          id: newChannel.id, 
          name: newChannel.name, 
          createdAt: now,
          lastMessageAt: 0 
        },
        ...prev
      ]);
      
      // Switch to the new channel
      switchToChannel(newChannel.id);
      
      console.log('✅ New chat created:', newChannel.id);
    } catch (error: any) {
      console.error('❌ Failed to create new chat:', error);
      alert(`Failed to create new chat: ${error.message}`);
    } finally {
      setIsCreatingChannel(false);
    }
  };

  // Switch to a different channel
  const switchToChannel = async (newChannelId: string) => {
    if (newChannelId === channelId) return;
    
    console.log('🔄 Switching to channel:', newChannelId);
    
    // Leave current channel
    if (channelId) {
      socketManager.leaveChannel(channelId);
    }
    
    // Clear messages
    setMessages([]);
    setChannelId(newChannelId);
    
    // Load messages for new channel
    try {
      const messagesResponse = await elizaClient.messaging.getChannelMessages(newChannelId as UUID, {
        limit: 50,
      });

      const formattedMessages: Message[] = messagesResponse.messages.map((msg) => {
        let timestamp: number;
        if (msg.createdAt instanceof Date) {
          timestamp = msg.createdAt.getTime();
        } else if (typeof msg.createdAt === 'number') {
          timestamp = msg.createdAt;
        } else if (typeof msg.createdAt === 'string') {
          timestamp = Date.parse(msg.createdAt);
        } else {
          timestamp = Date.now();
        }

        return {
          id: msg.id,
          content: msg.content,
          authorId: msg.authorId,
          createdAt: timestamp,
          isAgent: msg.authorId === agent.id,
          senderName: msg.metadata?.authorDisplayName || (msg.authorId === agent.id ? agent.name : 'User'),
        };
      });

      const sortedMessages = formattedMessages.sort((a, b) => a.createdAt - b.createdAt);
      setMessages(sortedMessages);
      console.log(`✅ Loaded ${sortedMessages.length} messages for new channel`);
    } catch (error: any) {
      console.warn('⚠️ Could not load messages for new channel:', error.message);
    }
    
    // Join new channel
    socketManager.joinChannel(newChannelId);
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden h-[calc(100vh-200px)] flex">
      {/* Sidebar - Channel List */}
      <div className={`${showSidebar ? 'w-64' : 'w-0'} bg-gray-900 text-white transition-all duration-300 overflow-hidden flex flex-col`}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Conversations</h3>
            <button
              onClick={handleCreateNewChat}
              disabled={isCreatingChannel}
              className="p-1 hover:bg-gray-700 rounded transition disabled:opacity-50"
              title="New Chat"
            >
              {isCreatingChannel ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
            </button>
          </div>
          <div className="flex items-center space-x-2 text-xs text-gray-400">
            <div className="w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-[10px]">
              {agent.name?.charAt(0).toUpperCase()}
            </div>
            <span className="truncate">{agent.name}</span>
          </div>
        </div>

        {/* Channel List */}
        <div className="flex-1 overflow-y-auto">
          {channels.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              No conversations yet
            </div>
          ) : (
            channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => switchToChannel(ch.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-800 transition border-l-2 ${
                  channelId === ch.id
                    ? 'bg-gray-800 border-indigo-500'
                    : 'border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm truncate">{ch.name}</span>
                  {channelId === ch.id && (
                    <svg className="w-3 h-3 text-indigo-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {ch.lastMessageAt && ch.lastMessageAt > 0 && (
                  <div className="text-xs text-gray-400">
                    {new Date(ch.lastMessageAt).toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Sidebar Toggle */}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-1 hover:bg-white/10 rounded transition"
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {showSidebar ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
            
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-lg font-bold">
                {agent.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h2 className="text-lg font-bold">{agent.name}</h2>
              <p className="text-sm text-blue-100">@{agent.username || 'unknown'}</p>
            </div>
          </div>
          
          {!channelId && (
            <div className="text-sm bg-yellow-500/20 px-3 py-1 rounded">
              Initializing...
            </div>
          )}
        </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-gray-500">Start a conversation with {agent.name}</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.isAgent ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-4 py-2 ${
                  message.isAgent
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'bg-blue-500 text-white'
                }`}
              >
                <div className="text-xs opacity-75 mb-1">
                  {message.senderName}
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">
                  {message.content}
                </div>
                <div className="text-xs opacity-50 mt-1">
                  {new Date(message.createdAt).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 bg-white">
        {!channelId ? (
          <div className="text-center py-2 text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p className="text-sm">Setting up chat... Check console for details</p>
          </div>
        ) : (
          <div className="flex space-x-2">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={1}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputText.trim() || sendMessageMutation.isPending}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {sendMessageMutation.isPending ? (
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                'Send'
              )}
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}


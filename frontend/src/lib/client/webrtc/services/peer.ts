// lib/client/webrtc/services/peer.ts

const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:global.stun.twilio.com:3478",
      ]
    }
  ]
};

class PeerService {
  public peer: RTCPeerConnection | null = null;
  private static instance: PeerService | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): PeerService {
    if (!PeerService.instance) {
      PeerService.instance = new PeerService();
    }
    return PeerService.instance;
  }

  private ensurePeerConnection(): boolean {
    // Check if we're in browser environment
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      console.warn('RTCPeerConnection not available in this environment');
      return false;
    }

    if (!this.peer) {
      try {
        this.peer = new RTCPeerConnection(servers);
        this.peer.oniceconnectionstatechange = () => {
          console.log("ICE Connection State:", this.peer?.iceConnectionState);
        };
      } catch (error) {
        console.error('Failed to create RTCPeerConnection:', error);
        return false;
      }
    }
    return true;
  }

  async getAnswer(offer: RTCSessionDescriptionInit) {
    if (!this.ensurePeerConnection()) {
      throw new Error('PeerConnection not available');
    }
    
    try {
      await this.peer!.setRemoteDescription(offer);
      const ans = await this.peer!.createAnswer();
      await this.peer!.setLocalDescription(new RTCSessionDescription(ans));
      return ans;
    } catch (error) {
      console.error('Error in getAnswer', error);
      throw error;
    }
  }

  async setRemoteDescription(ans: RTCSessionDescriptionInit) {
    if (!this.ensurePeerConnection()) {
      throw new Error('PeerConnection not available');
    }
    
    try {
      await this.peer!.setRemoteDescription(new RTCSessionDescription(ans));
    } catch (error) {
      console.error('Error in setRemoteDescription', error);
      throw error;
    }
  }

  async getOffer() {
    if (!this.ensurePeerConnection()) {
      throw new Error('PeerConnection not available');
    }
    
    try {
      const offer = await this.peer!.createOffer();
      await this.peer!.setLocalDescription(new RTCSessionDescription(offer));
      return offer;
    } catch (error) {
      console.error('Error in getOffer', error);
      throw error;
    }
  }

  closeConnection() {
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
  }

  // Helper method to check if peer is available
  isPeerAvailable(): boolean {
    return this.ensurePeerConnection();
  }
}

// Export a function that returns the singleton instance
export const getPeerService = (): PeerService => {
  return PeerService.getInstance();
};

// For backward compatibility, but only initialize when called
export const peer = {
  get peer() {
    const service = getPeerService();
    return service.isPeerAvailable() ? service.peer : null;
  },
  getOffer: () => getPeerService().getOffer(),
  getAnswer: (offer: RTCSessionDescriptionInit) => getPeerService().getAnswer(offer),
  setRemoteDescription: (ans: RTCSessionDescriptionInit) => getPeerService().setRemoteDescription(ans),
  closeConnection: () => getPeerService().closeConnection(),
};
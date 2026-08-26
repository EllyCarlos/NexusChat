// Configuration for STUN servers to help establish connections
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:global.stun.twilio.com:3478",
      ],
    },
  ],
};

/**
 * PeerService Class
 * Encapsulates WebRTC peer connection logic.
 * IMPORTANT: This class is designed to be instantiated ONLY on the client-side
 * using the `new PeerService()` syntax within a React component's lifecycle.
 */
export class PeerService {
  public peer: RTCPeerConnection | null = null;

  /**
   * Initializes the RTCPeerConnection if it doesn't already exist.
   * This is the gateway for all WebRTC operations to ensure the connection is live.
   * @returns {RTCPeerConnection | null} The active peer connection instance.
   */
  initializePeer(): RTCPeerConnection | null {
    // Check if running in a browser environment and if the peer doesn't exist yet
    if (typeof window !== 'undefined' && !this.peer) {
      try {
        this.peer = new RTCPeerConnection(servers);
      } catch {
        console.error('Failed to initialize the peer connection.');
      }
    }
    return this.peer;
  }

  /**
   * A safe getter that ensures the peer connection is initialized before returning it.
   * @private
   * @returns {RTCPeerConnection} The peer connection instance.
   * @throws {Error} If the peer connection cannot be initialized.
   */
  private getSafePeer(): RTCPeerConnection {
    const peer = this.initializePeer();
    if (!peer) {
      throw new Error("RTCPeerConnection is not initialized. Ensure this is running on the client.");
    }
    return peer;
  }
  
  // All public methods will now use getSafePeer() to guarantee initialization.

  async getOffer(): Promise<RTCSessionDescriptionInit | undefined> {
    try {
      const peer = this.getSafePeer();
      const offer = await peer.createOffer();
      await peer.setLocalDescription(new RTCSessionDescription(offer));
      return offer;
    } catch {
      console.error('Failed to create a call offer.');
    }
  }

  async getAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | undefined> {
    try {
      const peer = this.getSafePeer();
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(new RTCSessionDescription(answer));
      return answer;
    } catch {
      console.error('Failed to create a call answer.');
    }
  }

  async setRemoteDescription(ans: RTCSessionDescriptionInit): Promise<void> {
    try {
      const peer = this.getSafePeer();
      await peer.setRemoteDescription(new RTCSessionDescription(ans));
    } catch {
      console.error('Failed to apply the remote call description.');
    }
  }

  closeConnection(): void {
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
  }
}

// DO NOT EXPORT AN INSTANCE. The line below is the one we are removing.
// export const peer = new PeerService(); // <--- DELETE THIS LINE

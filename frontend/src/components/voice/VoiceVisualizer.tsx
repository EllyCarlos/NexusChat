import { useEffect, useRef } from "react";

interface AudioVisualizerProps {
  audioStream: MediaStream | null;
}

const AudioVisualizer = ({ audioStream }: AudioVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioStream || !canvasRef.current) return;

    // Create and resume AudioContext
    const audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch((err) => console.error("Failed to resume AudioContext:", err));
    }

    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(audioStream);
    source.connect(analyser);
    analyser.fftSize = 512; // Higher FFT size for better frequency resolution

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Get Canvas Context
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    canvas.width = 400;
    canvas.height = 100;

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 1.5; // Adjusted scaling
        ctx.fillStyle = `rgb(${barHeight + 100}, 50, 150)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    // Store references for cleanup
    audioContextRef.current = audioCtx;
    analyserRef.current = analyser;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      audioCtx.close();
    };
  }, [audioStream]);

  return <canvas ref={canvasRef} className="rounded-md shadow-md bg-black" />;
};

export default AudioVisualizer;

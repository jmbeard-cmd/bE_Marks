import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIdentity } from '../app/_layout';

interface Props {
  onVideoComplete: (uri: string) => void;
  existingUri?: string;
}

export default function VideoRecorder({ onVideoComplete, existingUri }: Props) {
  const { theme } = useIdentity();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | undefined>(existingUri);

useEffect(() => {
  setVideoUri(existingUri);
}, [existingUri]);
  const [duration, setDuration] = useState(0);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('back');

  const openCamera = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { Alert.alert('Permission needed', 'Allow camera access in settings.'); return; }
    }
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) { Alert.alert('Permission needed', 'Allow microphone access in settings.'); return; }
    }
    setCameraOpen(true);
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;
    try {
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(d => {
          if (d >= 30) {
            stopRecording();
            return 30;
          }
          return d + 1;
        });
      }, 1000);

      const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (video?.uri) {
        setVideoUri(video.uri);
        onVideoComplete(video.uri);
      }
      setCameraOpen(false);
    } catch {
      Alert.alert('Error', 'Could not record video.');
      setIsRecording(false);
      setCameraOpen(false);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    cameraRef.current?.stopRecording();
    setIsRecording(false);
  };

  const deleteVideo = () => {
  setVideoUri(undefined);
  onVideoComplete('');  // was: onVideoComplete('video.uri') — literal string bug
};

  if (cameraOpen) {
    return (
      <View style={s.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={s.camera}
          facing={facing}
          mode="video"
        />
        <View style={s.cameraControls}>
          {!isRecording ? (
            <>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setCameraOpen(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.startBtn} onPress={startRecording}>
                <View style={[s.startDot, { backgroundColor: theme.gold }]} />
              </TouchableOpacity>
              <TouchableOpacity 
  style={s.flipBtn} 
  onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
  disabled={isRecording}
>
  <Text style={s.flipText}>🔄</Text>
</TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.timerText}>{duration}s / 30s</Text>
              <TouchableOpacity style={s.stopBtn} onPress={stopRecording}>
                <View style={[s.stopSquare, { backgroundColor: theme.gold }]} />
              </TouchableOpacity>
              <View style={{ width: 70 }} />
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {!videoUri && (
        <TouchableOpacity style={s.recordBtn} onPress={openCamera}>
          <Text style={s.recordIcon}>🎥</Text>
          <Text style={s.recordText}>Record video clip</Text>
        </TouchableOpacity>
      )}

      {videoUri && (
        <View style={s.previewRow}>
          <View style={s.videoThumb}>
            <Text style={s.videoThumbIcon}>🎥</Text>
            <Text style={[s.videoThumbText, { color: theme.gold }]}>Video recorded</Text>
          </View>
          <TouchableOpacity style={s.deleteBtn} onPress={deleteVideo}>
            <Text style={s.deleteText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 4 },
  recordBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  recordIcon: { fontSize: 20 },
  recordText: { fontSize: 14, color: '#888', fontWeight: '500' },
  cameraContainer: { height: 300, borderRadius: 10, overflow: 'hidden', marginBottom: 4 },
  camera: { flex: 1 },
  cameraControls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, backgroundColor: 'rgba(0,0,0,0.4)' },
  cancelBtn: { width: 70 },
  cancelText: { color: '#fff', fontSize: 14 },
  startBtn: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  startDot: { width: 48, height: 48, borderRadius: 24 },
  stopBtn: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 28, height: 28, borderRadius: 4 },
  timerText: { color: '#fff', fontSize: 14, fontWeight: '600', width: 70 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  videoThumb: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  videoThumbIcon: { fontSize: 20 },
  videoThumbText: { fontSize: 14, fontWeight: '500' },
  deleteBtn: { padding: 14 },
  deleteText: { fontSize: 13, color: '#555' },
  flipBtn: { width: 70, alignItems: 'flex-end' },
flipText: { fontSize: 24 },
});
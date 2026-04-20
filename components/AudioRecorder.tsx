import { AudioModule, RecordingPresets, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  onRecordingComplete: (uri: string) => void;
  existingUri?: string;
}

export default function AudioRecorder({ onRecordingComplete, existingUri }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUri, setAudioUri] = useState<string | undefined>(existingUri);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(audioUri ? { uri: audioUri } : null);

  useEffect(() => {
    setAudioUri(existingUri);
  }, [existingUri]);

  useEffect(() => {
    if (player) {
      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status.didJustFinish) setIsPlaying(false);
      });
    }
  }, [player]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording) {
      interval = setInterval(() => {
        setDuration(d => {
          if (d >= 30) {
            stopRecording();
            return 30;
          }
          return d + 1;
        });
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert('Permission needed', 'Allow microphone access in settings.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setAudioUri(undefined);
    } catch (e) {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setIsRecording(false);
      if (uri) {
        setAudioUri(uri);
        onRecordingComplete(uri);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not stop recording.');
    }
  };

  const playAudio = async () => {
    if (!player) return;
    try {
      player.play();
      setIsPlaying(true);
    } catch (e) {
      Alert.alert('Error', 'Could not play audio.');
    }
  };

  const stopAudio = async () => {
    if (!player) return;
    player.pause();
    setIsPlaying(false);
  };

  const deleteAudio = () => {
    setAudioUri(undefined);
    setIsRecording(false);
    setDuration(0);
    onRecordingComplete('');
  };

  return (
    <View style={s.container}>
      {!audioUri && !isRecording && (
        <TouchableOpacity style={s.recordBtn} onPress={startRecording}>
          <Text style={s.recordIcon}>🎤</Text>
          <Text style={s.recordText}>Record voice note</Text>
        </TouchableOpacity>
      )}

      {isRecording && (
        <TouchableOpacity style={s.recordingBtn} onPress={stopRecording}>
          <View style={s.recordingDot} />
          <Text style={s.recordingText}>Recording... {duration}s / 30s — tap to stop</Text>
        </TouchableOpacity>
      )}

      {audioUri && !isRecording && (
        <View style={s.playbackRow}>
          <TouchableOpacity
            style={s.playBtn}
            onPress={isPlaying ? stopAudio : playAudio}
          >
            <Text style={s.playIcon}>{isPlaying ? '⏹' : '▶'}</Text>
            <Text style={s.playText}>{isPlaying ? 'Stop' : 'Play voice note'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.deleteBtn} onPress={deleteAudio}>
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
  recordingBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#c9973a', backgroundColor: '#1e1600' },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#c9973a' },
  recordingText: { fontSize: 13, color: '#c9973a', fontWeight: '500' },
  playbackRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  playBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  playIcon: { fontSize: 16 },
  playText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  deleteBtn: { padding: 14 },
  deleteText: { fontSize: 13, color: '#555' },
});
import { Ionicons } from '@expo/vector-icons';
import {
    CameraView,
    useCameraPermissions,
    type BarcodeScanningResult,
} from 'expo-camera';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Colors } from '../../src/constants/theme';
import {
    parseBEContactCard,
    type ParsedBEContactCard,
} from '../../src/utils/be-contact-card';

type Theme = typeof Colors.dark;

type QRContactScannerModalProps = {
  visible: boolean;
  theme: Theme;
  onClose: () => void;
  onContactScanned: (card: ParsedBEContactCard) => void;
};

export default function QRContactScannerModal({
  visible,
  theme,
  onClose,
  onContactScanned,
}: QRContactScannerModalProps) {
  const s = useMemo(() => createStyles(theme), [theme]);
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) {
      setLocked(false);
    }
  }, [visible]);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (locked) return;

    setLocked(true);

    const card = parseBEContactCard(result.data || '');

    if (!card) {
      Alert.alert(
        'Not a bE contact card',
        'This QR code does not contain a valid bE contact card or npub.',
        [
          {
            text: 'Try again',
            onPress: () => setLocked(false),
          },
        ]
      );
      return;
    }

    onContactScanned(card);
  }, [locked, onContactScanned]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity
            style={s.closeButton}
            onPress={onClose}
            activeOpacity={0.82}
          >
            <Ionicons name="close" size={24} color={theme.gold} />
          </TouchableOpacity>

          <View style={s.headerTextBlock}>
            <Text style={s.title}>Scan QR</Text>
            <Text style={s.subtitle}>Add a bE contact and start a DM.</Text>
          </View>

          <View style={{ width: 44 }} />
        </View>

        {!permission ? (
          <View style={s.center}>
            <ActivityIndicator color={theme.gold} />
            <Text style={s.centerText}>Checking camera permission…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={s.center}>
            <Ionicons name="camera-outline" size={42} color={theme.gold} />
            <Text style={s.permissionTitle}>Camera permission needed</Text>
            <Text style={s.permissionText}>
              Allow camera access to scan a bE contact QR card.
            </Text>

            <TouchableOpacity
              style={s.permissionButton}
              onPress={requestPermission}
              activeOpacity={0.84}
            >
              <Text style={s.permissionButtonText}>Allow Camera</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              onBarcodeScanned={locked ? undefined : handleBarcodeScanned}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
            />

            <View pointerEvents="none" style={s.scanFrame}>
              <View style={s.cornerTopLeft} />
              <View style={s.cornerTopRight} />
              <View style={s.cornerBottomLeft} />
              <View style={s.cornerBottomRight} />
            </View>

            <View style={s.footerCard}>
              <Text style={s.footerTitle}>Point camera at a bE contact QR</Text>
              <Text style={s.footerText}>
                The app will add/update the contact, then open the DM.
              </Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      minHeight: 76,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 0.5,
      borderColor: theme.border,
    },
    headerTextBlock: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
    },
    title: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '900',
    },
    subtitle: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 3,
      textAlign: 'center',
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 30,
      gap: 12,
    },
    centerText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    permissionTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '900',
      textAlign: 'center',
    },
    permissionText: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '700',
      textAlign: 'center',
    },
    permissionButton: {
      marginTop: 8,
      minHeight: 46,
      borderRadius: 23,
      paddingHorizontal: 20,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    permissionButtonText: {
      color: theme.bg,
      fontSize: 14,
      fontWeight: '900',
    },
    cameraWrap: {
      flex: 1,
      position: 'relative',
      overflow: 'hidden',
    },
    scanFrame: {
      position: 'absolute',
      left: '14%',
      right: '14%',
      top: '26%',
      height: 260,
    },
    cornerTopLeft: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: 52,
      height: 52,
      borderTopWidth: 5,
      borderLeftWidth: 5,
      borderColor: theme.gold,
      borderTopLeftRadius: 18,
    },
    cornerTopRight: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 52,
      height: 52,
      borderTopWidth: 5,
      borderRightWidth: 5,
      borderColor: theme.gold,
      borderTopRightRadius: 18,
    },
    cornerBottomLeft: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      width: 52,
      height: 52,
      borderBottomWidth: 5,
      borderLeftWidth: 5,
      borderColor: theme.gold,
      borderBottomLeftRadius: 18,
    },
    cornerBottomRight: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 52,
      height: 52,
      borderBottomWidth: 5,
      borderRightWidth: 5,
      borderColor: theme.gold,
      borderBottomRightRadius: 18,
    },
    footerCard: {
      position: 'absolute',
      left: 18,
      right: 18,
      bottom: 30,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: 'rgba(0,0,0,0.68)',
      borderWidth: 0.5,
      borderColor: theme.gold,
    },
    footerTitle: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '900',
      marginBottom: 4,
      textAlign: 'center',
    },
    footerText: {
      color: '#FFFFFF',
      opacity: 0.82,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
      textAlign: 'center',
    },
  });
}
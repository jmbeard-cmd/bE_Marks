import { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { GroupBoardDisplayMode } from '../src/utils/group-stickies';

type SpaceBoardComposerTheme = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  textMuted: string;
  gold: string;
};

type BoardDraftAttachmentLike = {
  id: string;
  uri: string;
  type: 'image' | 'video' | 'file';
  name?: string;
  mimeType?: string;
};

type SpaceBoardComposerModalProps = {
  visible: boolean;
  theme: SpaceBoardComposerTheme;
  displayMode: GroupBoardDisplayMode;
  title: string;
  body: string;
  attachments: BoardDraftAttachmentLike[];
  uploadStatus: string | null;
  saving: boolean;
  onClose: () => void;
  onChangeDisplayMode: (mode: GroupBoardDisplayMode) => void;
  onChangeTitle: (value: string) => void;
  onChangeBody: (value: string) => void;
  onPickMedia: () => void;
  onPickFiles: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSave: () => void;
};

export default function SpaceBoardComposerModal({
  visible,
  theme,
  displayMode,
  title,
  body,
  attachments,
  uploadStatus,
  saving,
  onClose,
  onChangeDisplayMode,
  onChangeTitle,
  onChangeBody,
  onPickMedia,
  onPickFiles,
  onRemoveAttachment,
  onSave,
}: SpaceBoardComposerModalProps) {
  const s = useMemo(() => createStyles(theme), [theme]);
  const saveDisabled = !title.trim() || !body.trim() || saving;
  const composerTitle =
    displayMode === 'alert'
      ? 'New Space Alert'
      : displayMode === 'announcement'
        ? 'New Space Announcement'
        : 'New Bulletin Board Pin';
  const composerSubtitle =
    displayMode === 'alert'
      ? 'Use alerts for urgent, high-priority Space notices.'
      : displayMode === 'announcement'
        ? 'Use announcements as a Space-wide broadcast people should see.'
        : 'Use pins for standing reminders, links, forms, and notes.';
  const titlePlaceholder =
    displayMode === 'alert'
      ? 'Example: Game moved indoors'
      : displayMode === 'announcement'
        ? 'Example: Parent meeting this Thursday'
        : 'Example: Practice schedule';
  const bodyPlaceholder =
    displayMode === 'alert'
      ? 'Add what changed, who needs to know, and what they should do next.'
      : displayMode === 'announcement'
        ? 'Add the details people need for this Space-wide update.'
        : 'Add the details people may need to reference later.';
  const saveLabel =
    displayMode === 'alert'
      ? 'Post alert'
      : displayMode === 'announcement'
        ? 'Post announcement'
        : 'Save pin';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.modalOverlay}>
        <ScrollView
          contentContainerStyle={s.modalCard}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.modalTitle}>{composerTitle}</Text>
          <Text style={s.modalSubtitle}>{composerSubtitle}</Text>

          <Text style={s.inputLabel}>TYPE</Text>
          <View style={s.visibilityBox}>
            <TouchableOpacity
              style={[
                s.visibilityOption,
                displayMode === 'pin' && s.visibilityOptionActive,
              ]}
              onPress={() => onChangeDisplayMode('pin')}
              activeOpacity={0.84}
            >
              <Text style={s.visibilityIcon}>📌</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.visibilityTitle}>Pin</Text>
                <Text style={s.visibilityHint}>A standing board item people can find later.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.visibilityOption,
                displayMode === 'announcement' && s.visibilityOptionActive,
              ]}
              onPress={() => onChangeDisplayMode('announcement')}
              activeOpacity={0.84}
            >
              <Text style={s.visibilityIcon}>📣</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.visibilityTitle}>Announcement</Text>
                <Text style={s.visibilityHint}>A Space-wide broadcast people should see.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.visibilityOption,
                displayMode === 'alert' && s.visibilityOptionActive,
              ]}
              onPress={() => onChangeDisplayMode('alert')}
              activeOpacity={0.84}
            >
              <Text style={s.visibilityIcon}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.visibilityTitle}>Alert</Text>
                <Text style={s.visibilityHint}>An urgent, high-priority Space notice.</Text>
              </View>
            </TouchableOpacity>
          </View>

          <Text style={s.inputLabel}>TITLE</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={onChangeTitle}
            placeholder={titlePlaceholder}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="sentences"
          />

          <Text style={s.inputLabel}>MESSAGE</Text>
          <TextInput
            style={[s.input, s.inputMulti, { textAlignVertical: 'top' }]}
            value={body}
            onChangeText={onChangeBody}
            placeholder={bodyPlaceholder}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="sentences"
            multiline
          />

          <Text style={s.inputLabel}>ATTACHMENTS</Text>
          <View style={s.modalActions}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={onPickMedia}
              disabled={saving}
              activeOpacity={0.84}
            >
              <Text style={s.cancelText}>Photo / Video</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.cancelBtn}
              onPress={onPickFiles}
              disabled={saving}
              activeOpacity={0.84}
            >
              <Text style={s.cancelText}>File</Text>
            </TouchableOpacity>
          </View>

          {attachments.length > 0 && (
            <View style={s.stickyFileList}>
              {attachments.map(attachment => (
                <View key={attachment.id} style={s.stickyFileRow}>
                  <Text style={s.stickyFileIcon}>
                    {attachment.type === 'video' ? '🎥' : attachment.type === 'image' ? '🖼️' : '📎'}
                  </Text>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.stickyFileName} numberOfLines={1}>
                      {attachment.name ||
                        (attachment.type === 'video'
                          ? 'Selected video'
                          : attachment.type === 'image'
                            ? 'Selected photo'
                            : 'Selected file')}
                    </Text>
                    <Text style={s.stickyFileMeta}>
                      {attachment.type === 'video'
                        ? 'Video'
                        : attachment.type === 'image'
                          ? 'Photo'
                          : attachment.mimeType || 'File'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={() => onRemoveAttachment(attachment.id)}
                    disabled={saving}
                  >
                    <Text style={s.stickyFileOpen}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {uploadStatus ? (
            <Text style={s.stickyMeta}>{uploadStatus}</Text>
          ) : null}

          <View style={s.modalActions}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.confirmBtn,
                saveDisabled && s.confirmBtnDisabled,
              ]}
              onPress={onSave}
              disabled={saveDisabled}
            >
              <Text style={s.confirmText}>
                {saving ? 'Saving…' : saveLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (theme: SpaceBoardComposerTheme) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
    gap: 10,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 4,
  },
  modalSubtitle: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginBottom: 4,
  },
  inputLabel: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginTop: 8,
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 0.7,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    fontWeight: '700',
  },
  inputMulti: {
    minHeight: 116,
  },
  visibilityBox: {
    gap: 8,
    marginTop: 4,
  },
  visibilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  visibilityOptionActive: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  visibilityIcon: {
    fontSize: 20,
  },
  visibilityTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  visibilityHint: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 0.7,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancelText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '900',
  },
  confirmBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  confirmBtnDisabled: {
    opacity: 0.45,
  },
  confirmText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '900',
  },
  stickyFileList: {
    gap: 8,
    marginTop: 8,
  },
  stickyFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 0.7,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stickyFileIcon: {
    fontSize: 18,
  },
  stickyFileName: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '900',
  },
  stickyFileMeta: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  stickyFileOpen: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  stickyMeta: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
});
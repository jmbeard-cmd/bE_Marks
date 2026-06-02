import { Ionicons } from '@expo/vector-icons';
import type { Ref } from 'react';
import {
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { formatDate } from '../src/utils/storage';

type MarkCommentsSheetTheme = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  textMuted: string;
  gold: string;
};

type MarkComment = {
  text?: string;
  createdAt?: number;
  authorNpub?: string;
};

type MarkCommentsSheetItem = {
  id: string;
  authorName: string;
  authorInitials: string;
  authorAvatar?: string;
  contextLabel: string;
  milestone: {
    reflections?: MarkComment[];
  };
};

type MarkCommentsSheetProps = {
  item: MarkCommentsSheetItem;
  currentNpub: string | null;
  draft: string;
  saving: boolean;
  theme: MarkCommentsSheetTheme;
  bottom: number;
  bottomPadding: number;
  inputRef?: Ref<TextInput>;
  onDraftChange: (text: string) => void;
  onClose: () => void;
  onSend: () => void;
};

export default function MarkCommentsSheet({
  item,
  currentNpub,
  draft,
  saving,
  theme,
  bottom,
  bottomPadding,
  inputRef,
  onDraftChange,
  onClose,
  onSend,
}: MarkCommentsSheetProps) {
  const comments = item.milestone.reflections ?? [];
  const canSend = draft.trim().length > 0 && !saving;

  return (
    <View style={s.overlay} pointerEvents="box-none">
      <TouchableOpacity
        style={s.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      <View
        style={[
          s.sheet,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            bottom,
            paddingBottom: bottomPadding,
          },
        ]}
      >
        <View style={[s.handle, { backgroundColor: theme.border }]} />

        <View style={s.header}>
          <View
            style={[
              s.avatar,
              {
                backgroundColor: theme.raised,
                borderColor: theme.border,
              },
            ]}
          >
            {item.authorAvatar ? (
              <Image source={{ uri: item.authorAvatar }} style={s.avatarImage} />
            ) : (
              <Text style={[s.avatarText, { color: theme.gold }]}>
                {item.authorInitials}
              </Text>
            )}
          </View>

          <View style={s.headerCopy}>
            <Text style={[s.title, { color: theme.text }]}>
              Comments
            </Text>
            <Text style={[s.context, { color: theme.textMuted }]} numberOfLines={1}>
              {item.authorName} - {item.contextLabel}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              s.closeBtn,
              {
                backgroundColor: theme.raised,
                borderColor: theme.border,
              },
            ]}
            onPress={onClose}
            activeOpacity={0.78}
            disabled={saving}
          >
            <Text style={[s.closeText, { color: theme.textMuted }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={s.commentsScroll}
          contentContainerStyle={s.commentsScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {comments.length === 0 ? (
            <View
              style={[
                s.emptyCard,
                {
                  backgroundColor: theme.raised,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={[s.emptyTitle, { color: theme.text }]}>
                No comments yet
              </Text>
              <Text style={[s.emptyHint, { color: theme.textMuted }]}>
                Start the conversation around this Mark.
              </Text>
            </View>
          ) : (
            [...comments]
              .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
              .map((comment, index) => {
                const isMine = !!currentNpub && comment.authorNpub === currentNpub;
                const commentAuthor = isMine
                  ? 'You'
                  : comment.authorNpub
                    ? `${comment.authorNpub.slice(0, 10)}…`
                    : 'Member';

                return (
                  <View
                    key={`comment_${item.id}_${comment.createdAt}_${index}`}
                    style={[
                      s.commentBubble,
                      isMine ? s.commentBubbleMine : s.commentBubbleOther,
                      {
                        backgroundColor: isMine ? `${theme.gold}18` : theme.raised,
                        borderColor: isMine ? `${theme.gold}44` : theme.border,
                      },
                    ]}
                  >
                    <View style={s.commentBubbleHeader}>
                      <Text style={[s.commentAuthor, { color: isMine ? theme.gold : theme.text }]}>
                        {commentAuthor}
                      </Text>

                      <Text style={[s.commentTime, { color: theme.textMuted }]}>
                        {comment.createdAt ? formatDate(comment.createdAt) : 'Now'}
                      </Text>
                    </View>

                    <Text style={[s.commentText, { color: theme.text }]}>
                      {comment.text}
                    </Text>
                  </View>
                );
              })
          )}
        </ScrollView>

        <View style={[s.inputBar, { borderColor: theme.border }]}>
          <TextInput
            ref={inputRef}
            style={[
              s.input,
              {
                backgroundColor: theme.raised,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={draft}
            onChangeText={onDraftChange}
            placeholder="Add a comment."
            placeholderTextColor={theme.textMuted}
            multiline
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={[
              s.sendBtn,
              { backgroundColor: theme.gold },
              !canSend && s.sendBtnDisabled,
            ]}
            onPress={onSend}
            activeOpacity={0.78}
            disabled={!canSend}
          >
            <Ionicons name="send" size={18} color={theme.bg} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0.5,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '78%',
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '900',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
  },
  context: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '900',
  },
  commentsScroll: {
    maxHeight: 320,
  },
  commentsScrollContent: {
    paddingTop: 4,
    paddingBottom: 12,
    gap: 10,
  },
  emptyCard: {
    borderWidth: 0.5,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 17,
  },
  commentBubble: {
    borderWidth: 0.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: '92%',
  },
  commentBubbleMine: {
    alignSelf: 'flex-end',
  },
  commentBubbleOther: {
    alignSelf: 'flex-start',
  },
  commentBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: '900',
  },
  commentTime: {
    fontSize: 10,
    fontWeight: '700',
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  inputBar: {
    borderTopWidth: 0.5,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 104,
    borderWidth: 0.5,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
});
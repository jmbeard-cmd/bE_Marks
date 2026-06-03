import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../src/constants/theme';
import type { GroupSticky } from '../src/utils/group-stickies';
import MediaCollage from './MediaCollage';

type SpaceStickyHighlightCardProps = {
  sticky: GroupSticky;
  theme: typeof Colors.light;
  isAdmin: boolean;
  createdAtLabel: string;
  onDelete: () => void;
  onPressMedia: (index: number) => void;
  onOpenFile: (fileUrl?: string) => void;
};

function getStickyMediaItems(sticky: GroupSticky): any[] {
  const media = (sticky as any).media;

  if (!media) return [];

  return Array.isArray(media) ? media : [media];
}

function getStickyVisualMediaItems(sticky: GroupSticky): any[] {
  return getStickyMediaItems(sticky).filter(item => {
    const mediaType = item.mediaType || item.type;

    return mediaType === 'image' || mediaType === 'video';
  });
}

function getStickyFileItems(sticky: GroupSticky): any[] {
  return getStickyMediaItems(sticky).filter(item => {
    const mediaType = item.mediaType || item.type;

    return mediaType === 'file';
  });
}

export default function SpaceStickyHighlightCard({
  sticky,
  theme,
  isAdmin,
  createdAtLabel,
  onDelete,
  onPressMedia,
  onOpenFile,
}: SpaceStickyHighlightCardProps) {
  const s = createStyles(theme);
  const visualMediaItems = getStickyVisualMediaItems(sticky);
  const fileItems = getStickyFileItems(sticky);

  return (
    <View style={s.stickyCard}>
      <View style={s.stickyTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.stickyTitle}>{sticky.title}</Text>
          <Text style={s.legacyStickyLabel}>Legacy highlight</Text>
        </View>

        {isAdmin && (
          <TouchableOpacity onPress={onDelete}>
            <Text style={s.stickyDelete}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {sticky.body ? (
        <Text style={s.stickyBody}>{sticky.body}</Text>
      ) : null}

      {visualMediaItems.length > 0 && (
        <MediaCollage
          media={visualMediaItems}
          onPressMedia={onPressMedia}
        />
      )}

      {fileItems.length > 0 && (
        <View style={s.stickyFileList}>
          {fileItems.map((file, index) => (
            <TouchableOpacity
              key={`${sticky.id}_file_${index}`}
              style={s.stickyFileRow}
              onPress={() => onOpenFile(file.mediaUrl || file.uri)}
              activeOpacity={0.82}
            >
              <Text style={s.stickyFileIcon}>📎</Text>

              <View style={{ flex: 1 }}>
                <Text style={s.stickyFileName} numberOfLines={1}>
                  {file.fileName || file.name || 'Attached file'}
                </Text>

                {!!file.mimeType && (
                  <Text style={s.stickyFileMeta} numberOfLines={1}>
                    {file.mimeType}
                  </Text>
                )}
              </View>

              <Text style={s.stickyFileOpen}>Open</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={s.stickyMeta}>
        Legacy note - {createdAtLabel}
      </Text>
    </View>
  );
}

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
  stickyCard: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    marginBottom: 13,
  },
  stickyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 9,
  },
  stickyTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  legacyStickyLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  stickyDelete: {
    color: '#555',
    fontSize: 16,
    paddingHorizontal: 4,
    fontWeight: '700',
  },
  stickyBody: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 21,
  },
  stickyMeta: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 12,
    fontWeight: '600',
  },
  stickyFileList: {
    gap: 8,
    marginTop: 12,
  },
  stickyFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.raised,
    borderRadius: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  stickyFileIcon: {
    fontSize: 18,
  },
  stickyFileName: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  stickyFileMeta: {
    color: theme.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  stickyFileOpen: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
});
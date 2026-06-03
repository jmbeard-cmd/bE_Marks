import type { SocialGraphPerson } from '@/src/utils/social-graph-storage';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type SocialPersonCardProps = {
  person: SocialGraphPerson;
  theme: any;
  label?: string;
  variant?: 'compact' | 'full';
  onPress?: () => void;
};

function getPersonInitials(person: SocialGraphPerson): string {
  const source =
    person.displayName ||
    person.npub ||
    person.pubkey ||
    '';

  const clean = source.trim();

  if (!clean) return 'P';

  const parts = clean
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]}${parts[1]}`.toUpperCase();
  }

  return clean.slice(0, 2).toUpperCase();
}

function shortenIdentifier(value: string, front = 12, back = 6): string {
  const clean = value.trim();

  if (!clean) return '';
  if (clean.length <= front + back + 1) return clean;

  return `${clean.slice(0, front)}…${clean.slice(-back)}`;
}

function getPersonTitle(person: SocialGraphPerson): string {
  return (
    person.displayName ||
    (person.npub ? shortenIdentifier(person.npub) : '') ||
    shortenIdentifier(person.pubkey)
  );
}

function getPersonSubtitle(person: SocialGraphPerson): string {
  if (person.npub) {
    return shortenIdentifier(person.npub);
  }

  return shortenIdentifier(person.pubkey);
}

export default function SocialPersonCard({
  person,
  theme,
  label,
  variant = 'full',
  onPress,
}: SocialPersonCardProps) {
  const s = createStyles(theme);
  const initials = getPersonInitials(person);
  const title = getPersonTitle(person);
  const subtitle = getPersonSubtitle(person);
  const isCompact = variant === 'compact';

  return (
    <TouchableOpacity
      style={[s.card, isCompact && s.compactCard]}
      onPress={onPress}
      activeOpacity={onPress ? 0.82 : 1}
      disabled={!onPress}
    >
      {person.avatarUrl ? (
        <Image
          source={{ uri: person.avatarUrl }}
          style={isCompact ? s.compactAvatar : s.avatar}
        />
      ) : (
        <View style={[s.avatarFallback, isCompact && s.compactAvatarFallback]}>
          <Text style={[s.avatarFallbackText, isCompact && s.compactAvatarFallbackText]}>
            {initials}
          </Text>
        </View>
      )}

      <View style={s.body}>
        <View style={s.topRow}>
          <Text style={[s.title, isCompact && s.compactTitle]} numberOfLines={1}>
            {title}
          </Text>

          {!!label && (
            <View style={s.labelPill}>
              <Text style={s.labelText}>{label}</Text>
            </View>
          )}
        </View>

        <Text style={s.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>

        {!isCompact && !!person.about && (
          <Text style={s.about} numberOfLines={2}>
            {person.about}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function createStyles(theme: any) {
  const raised = theme?.raised ?? theme?.card ?? '#151515';
  const border = theme?.border ?? 'rgba(255,255,255,0.10)';
  const text = theme?.text ?? '#FFFFFF';
  const textSecondary = theme?.textSecondary ?? theme?.subtext ?? '#A3A3A3';
  const gold = theme?.gold ?? '#D6A84F';
  const goldDim = theme?.goldDim ?? 'rgba(214,168,79,0.16)';

  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderColor: border,
      borderRadius: 18,
      padding: 12,
      backgroundColor: raised,
    },
    compactCard: {
      minHeight: 64,
      paddingVertical: 9,
      paddingHorizontal: 11,
      borderRadius: 16,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: goldDim,
    },
    compactAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: goldDim,
    },
    avatarFallback: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: goldDim,
      borderWidth: 1,
      borderColor: gold,
    },
    compactAvatarFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    avatarFallbackText: {
      color: gold,
      fontSize: 15,
      fontWeight: '900',
    },
    compactAvatarFallbackText: {
      fontSize: 13,
    },
    body: {
      flex: 1,
      minWidth: 0,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      flex: 1,
      color: text,
      fontSize: 15,
      fontWeight: '900',
    },
    compactTitle: {
      fontSize: 14,
    },
    subtitle: {
      marginTop: 2,
      color: textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    about: {
      marginTop: 5,
      color: textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
    },
    labelPill: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: goldDim,
    },
    labelText: {
      color: gold,
      fontSize: 10,
      fontWeight: '900',
    },
  });
}
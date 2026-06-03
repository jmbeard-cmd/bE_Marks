import type { SocialGraphPerson } from '@/src/utils/social-graph-storage';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type SocialPersonCardProps = {
  person: SocialGraphPerson;
  theme: any;
  label?: string;
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

function getPersonTitle(person: SocialGraphPerson): string {
  return (
    person.displayName ||
    person.npub?.slice(0, 18) ||
    `${person.pubkey.slice(0, 12)}…`
  );
}

function getPersonSubtitle(person: SocialGraphPerson): string {
  return person.npub || `${person.pubkey.slice(0, 16)}…`;
}

export default function SocialPersonCard({
  person,
  theme,
  label,
  onPress,
}: SocialPersonCardProps) {
  const s = createStyles(theme);
  const initials = getPersonInitials(person);
  const title = getPersonTitle(person);
  const subtitle = getPersonSubtitle(person);

  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      activeOpacity={onPress ? 0.82 : 1}
      disabled={!onPress}
    >
      {person.avatarUrl ? (
        <Image
          source={{ uri: person.avatarUrl }}
          style={s.avatar}
        />
      ) : (
        <View style={s.avatarFallback}>
          <Text style={s.avatarFallbackText}>{initials}</Text>
        </View>
      )}

      <View style={s.body}>
        <View style={s.topRow}>
          <Text style={s.title} numberOfLines={1}>
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

        {!!person.about && (
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
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
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
    avatarFallbackText: {
      color: gold,
      fontSize: 15,
      fontWeight: '900',
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
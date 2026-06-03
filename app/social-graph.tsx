import SocialGraphSummaryCard from '@/components/SocialGraphSummaryCard';
import SocialPersonCard from '@/components/SocialPersonCard';
import SocialRelayInfoCard from '@/components/SocialRelayInfoCard';
import {
    syncFollowerGraph,
    syncFollowingGraph,
} from '@/src/utils/nostr-social';
import {
    getSocialGraphCache,
    getSocialRelays,
    type SocialGraphCache,
    type SocialGraphPerson,
} from '@/src/utils/social-graph-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIdentity } from './_layout';

type SocialGraphTab = 'following' | 'followers';

function emptyCache(): SocialGraphCache {
  return {
    followingPubkeys: [],
    followerPubkeys: [],
    peopleByPubkey: {},
  };
}

function formatLastUpdated(cache: SocialGraphCache): string | undefined {
  const latest = Math.max(
    cache.followingUpdatedAt ?? 0,
    cache.followersUpdatedAt ?? 0
  );

  if (!latest) return undefined;

  const date = new Date(latest * 1000);

  return `Last synced ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function peopleForPubkeys(
  pubkeys: string[],
  peopleByPubkey: Record<string, SocialGraphPerson>
): SocialGraphPerson[] {
  return pubkeys.map(pubkey => (
    peopleByPubkey[pubkey] ?? {
      pubkey,
    }
  ));
}

export default function SocialGraphScreen() {
  const router = useRouter();
  const { npub, theme } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);

  const [tab, setTab] = useState<SocialGraphTab>('following');
  const [cache, setCache] = useState<SocialGraphCache>(() => emptyCache());
  const [relays, setRelays] = useState<string[]>([]);
  const [loadingCache, setLoadingCache] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const followingPeople = useMemo(() => {
    return peopleForPubkeys(cache.followingPubkeys, cache.peopleByPubkey);
  }, [cache.followingPubkeys, cache.peopleByPubkey]);

  const followerPeople = useMemo(() => {
    return peopleForPubkeys(cache.followerPubkeys, cache.peopleByPubkey);
  }, [cache.followerPubkeys, cache.peopleByPubkey]);

  const visiblePeople = tab === 'following' ? followingPeople : followerPeople;

  const lastUpdatedLabel = useMemo(() => {
    return formatLastUpdated(cache);
  }, [cache]);

  const loadLocalSocialGraph = useCallback(async () => {
    setLoadingCache(true);

    try {
      const [nextCache, nextRelays] = await Promise.all([
        getSocialGraphCache(),
        getSocialRelays(),
      ]);

      setCache(nextCache);
      setRelays(nextRelays);
    } catch (error) {
      console.warn('[Social Graph] local load failed:', error);
    } finally {
      setLoadingCache(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!npub || syncing) return;

    setSyncing(true);

    try {
      await syncFollowingGraph({
        npub,
        hydrateProfiles: true,
      });

      await syncFollowerGraph({
        npub,
        hydrateProfiles: true,
      });

      const [nextCache, nextRelays] = await Promise.all([
        getSocialGraphCache(),
        getSocialRelays(),
      ]);

      setCache(nextCache);
      setRelays(nextRelays);
    } catch (error) {
      console.warn('[Social Graph] refresh failed:', error);
      Alert.alert('Sync failed', 'Could not refresh your social graph from connected relays.');
    } finally {
      setSyncing(false);
    }
  }, [npub, syncing]);

  useEffect(() => {
    loadLocalSocialGraph();
  }, [loadLocalSocialGraph]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity
          style={s.backButton}
          onPress={() => router.back()}
          activeOpacity={0.82}
        >
          <Ionicons name="arrow-back" size={20} color={theme.text} />
        </TouchableOpacity>

        <View style={s.headerTextWrap}>
          <Text style={s.headerKicker}>Account</Text>
          <Text style={s.headerTitle}>Social Graph</Text>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={syncing || loadingCache}
            onRefresh={handleRefresh}
            tintColor={theme.gold}
          />
        }
      >
        {!npub && (
          <View style={s.noticeCard}>
            <Text style={s.noticeTitle}>Identity needed</Text>
            <Text style={s.noticeText}>
              Sign in with your Nostr identity before syncing Following and Followers.
            </Text>
          </View>
        )}

        <SocialGraphSummaryCard
          theme={theme}
          followingCount={cache.followingPubkeys.length}
          followersCount={cache.followerPubkeys.length}
          syncing={syncing}
          lastUpdatedLabel={lastUpdatedLabel}
          onRefresh={npub ? handleRefresh : undefined}
        />

        <SocialRelayInfoCard
          theme={theme}
          relays={relays}
        />

        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tabButton, tab === 'following' && s.tabButtonActive]}
            onPress={() => setTab('following')}
            activeOpacity={0.86}
          >
            <Text style={[s.tabText, tab === 'following' && s.tabTextActive]}>
              Following
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tabButton, tab === 'followers' && s.tabButtonActive]}
            onPress={() => setTab('followers')}
            activeOpacity={0.86}
          >
            <Text style={[s.tabText, tab === 'followers' && s.tabTextActive]}>
              Followers
            </Text>
          </TouchableOpacity>
        </View>

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>
            {tab === 'following' ? 'People you follow' : 'Best-effort followers'}
          </Text>
          <Text style={s.sectionHint}>
            {tab === 'following'
              ? 'These people can feed Timeline > Following later.'
              : 'Followers are discovered from connected relays and may be incomplete.'}
          </Text>
        </View>

        {visiblePeople.length > 0 ? (
          <View style={s.peopleList}>
            {visiblePeople.map(person => (
              <SocialPersonCard
                key={person.pubkey}
                person={person}
                theme={theme}
                label={tab === 'following' ? 'Following' : 'Follower'}
              />
            ))}
          </View>
        ) : (
          <View style={s.emptyCard}>
            <View style={s.emptyIcon}>
              <Ionicons
                name={tab === 'following' ? 'person-add-outline' : 'people-outline'}
                size={22}
                color={theme.gold}
              />
            </View>
            <Text style={s.emptyTitle}>
              {tab === 'following' ? 'No following found yet' : 'No followers found yet'}
            </Text>
            <Text style={s.emptyText}>
              {tab === 'following'
                ? 'Refresh to fetch your kind 3 follow list from your Account social relays.'
                : 'Follower lookup is best-effort and depends on the relays searched.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: any) {
  const bg = theme?.bg ?? '#050505';
  const raised = theme?.raised ?? theme?.card ?? '#151515';
  const border = theme?.border ?? 'rgba(255,255,255,0.10)';
  const text = theme?.text ?? '#FFFFFF';
  const textSecondary = theme?.textSecondary ?? theme?.subtext ?? '#A3A3A3';
  const gold = theme?.gold ?? '#D6A84F';
  const goldDim = theme?.goldDim ?? 'rgba(214,168,79,0.16)';

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: border,
      backgroundColor: bg,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: raised,
      borderWidth: 1,
      borderColor: border,
    },
    headerTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    headerKicker: {
      color: gold,
      fontSize: 11,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    headerTitle: {
      color: text,
      fontSize: 22,
      fontWeight: '900',
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: 16,
      paddingBottom: 32,
      gap: 14,
    },
    noticeCard: {
      borderWidth: 1,
      borderColor: gold,
      borderRadius: 18,
      padding: 14,
      backgroundColor: goldDim,
    },
    noticeTitle: {
      color: gold,
      fontSize: 15,
      fontWeight: '900',
    },
    noticeText: {
      marginTop: 4,
      color: text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    tabRow: {
      flexDirection: 'row',
      gap: 10,
      padding: 4,
      borderRadius: 999,
      backgroundColor: raised,
      borderWidth: 1,
      borderColor: border,
    },
    tabButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      paddingVertical: 10,
    },
    tabButtonActive: {
      backgroundColor: gold,
    },
    tabText: {
      color: textSecondary,
      fontSize: 13,
      fontWeight: '900',
    },
    tabTextActive: {
      color: bg,
    },
    sectionHeader: {
      gap: 4,
    },
    sectionTitle: {
      color: text,
      fontSize: 18,
      fontWeight: '900',
    },
    sectionHint: {
      color: textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    peopleList: {
      gap: 10,
    },
    emptyCard: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: border,
      borderRadius: 22,
      padding: 18,
      backgroundColor: raised,
    },
    emptyIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: goldDim,
      borderWidth: 1,
      borderColor: gold,
      marginBottom: 10,
    },
    emptyTitle: {
      color: text,
      fontSize: 16,
      fontWeight: '900',
      textAlign: 'center',
    },
    emptyText: {
      marginTop: 6,
      color: textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
  });
}
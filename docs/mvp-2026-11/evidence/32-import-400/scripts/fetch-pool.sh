#!/bin/sh
# One paginated Debate-tag read per allowed space (the 12 canonical spaces minus Podcasts).
D="$1"
cd /x/work/geo-agents || exit 1
mkdir -p "$D/pool"
for S in 4582fbbee28a16589154f7e36f1ee3c5 89bd89bf28ff8a0963faf92a8c905e20 41e851610e13a19441c4d980f2f2ce6b 52c7ae149838b6d47ce0f3b2a5974546 c9f267dcb0d270718c2a3c45a64afd32 870e3b3068661e6280fad2ab456829bc 19f11bc6f1a62ac434936af814d1f8b5 d69608290513c2a91102c939b3265bd7 ec349623f33236aee13c12dcd629ee81 9b611b848b12491b9b6b43f3cf019b8b 84a679ce188f061ac9a92380bac2bab5 784bfddae3f3976118c561bf28195b44; do
  node agents/claim-tagger-mvp/scripts/geo-query.mjs --query-file "$D/q-debate.graphql" --vars "{\"space\":\"$S\"}" --paginate relationsConnection --out "$D/pool/$S.json" || echo "FAILED $S"
done

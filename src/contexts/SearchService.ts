import { SearchResponse } from 'src/entity/SearchResponse';
import { CONTROLLED_ASSETS } from 'src/data/ControlledAssets';

const BASE_URL = 'https://datapi.jup.ag';

class SearchService {
  private ROUTE = {
    SEARCH: `${BASE_URL}/v1/assets`,
  };

  async search(query: string): Promise<SearchResponse> {
    const local = CONTROLLED_ASSETS.filter((asset) => asset.id === query || asset.symbol.toLowerCase() === query.toLowerCase());
    if (local.length) return local;
    const response = await fetch(`${this.ROUTE.SEARCH}/search?query=${encodeURIComponent(query)}`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Token search is temporarily unavailable.');
    const data: SearchResponse = await response.json();
    return data;
  }
}

export const searchService = new SearchService();

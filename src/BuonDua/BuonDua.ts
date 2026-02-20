import {
    PagedResults,
    SourceManga,
    Chapter,
    ChapterDetails,
    HomeSection,
    SearchRequest,
    SourceInfo,
    PartialSourceManga,
    Tag,
    Request,
    Response,
    ContentRating,
    TagSection,
    HomeSectionType,
    ChapterProviding,
    SourceIntents,
    DUISection,
    SearchResultsProviding,
    HomePageSectionsProviding
} from '@paperback/types'

const BASE_URL = 'https://buondua.com'

export const BuonDuaInfo: SourceInfo = {
    author: 'FantomSloth',
    description: 'BuonDua manga source extension for Paperback',
    icon: 'icon.png',
    name: 'BuonDua',
    version: '1.0.1',
    authorWebsite: 'https://github.com/fantomthesloth',
    websiteBaseURL: BASE_URL,
    contentRating: ContentRating.ADULT,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.SETTINGS_UI
}

export class BuonDua implements ChapterProviding, SearchResultsProviding, HomePageSectionsProviding {
    BASE_URL = BASE_URL

    constructor(private cheerio: CheerioAPI) { }

    stateManager = App.createSourceStateManager()

    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 30000,
        interceptor: {
            interceptRequest: async (request: Request) => {
                request.headers = {
                    ...request.headers,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://www.google.com/',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    async getSourceMenu(): Promise<DUISection> {
        return App.createDUISection({
            id: 'main',
            header: 'Source Settings',
            isHidden: false,
            rows: async () => []
        })
    }

    getMangaShareUrl(mangaId: string): string { return `${this.BASE_URL}${mangaId}` }

    async getSearchTags(): Promise<TagSection[]> {
        return []
    }

    async supportsSearchOperators(): Promise<boolean> {
        return false
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const html = response.data as string
        const $ = this.cheerio.load(html)

        // Extract title from h1 in article header
        const title = $('.article-header h1').first().text().trim() || $('h1').first().text().trim()

        // Extract thumbnail from og:image
        const thumbnail = $('meta[property="og:image"]').attr('content') || ''

        // Extract description
        const description = $('meta[property="og:description"]').attr('content') || 'No description available'

        // Extract tags from .article-tags .tag
        const tags: Tag[] = []
        $('.article-tags .tag').each((i, element) => {
            const tagName = $(element).text().trim()
            if (tagName) {
                tags.push(App.createTag({
                    id: tagName.toLowerCase().replace(/\s+/g, '-'),
                    label: tagName
                }))
            }
        })

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title],
                image: thumbnail,
                desc: description,
                status: 'Finished',
                author: 'BuonDua',
                tags: [App.createTagSection({ id: 'tags', label: 'Tags', tags: tags })]
            })
        })
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        // BuonDua galleries typically have one "chapter" with all images
        return [
            App.createChapter({
                id: '1',
                name: mangaId,
                chapNum: 1,
                volume: 1,
                langCode: 'EN'
            })
        ]
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const pages: string[] = []
        let currentPage = 1
        let totalPages = 1

        // Fetch all pages of the gallery
        while (currentPage <= totalPages) {
            const url = currentPage === 1
                ? (mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId)
                : (mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId) + `?page=${currentPage}`

            const request = App.createRequest({
                url: url,
                method: 'GET'
            })

            const response = await this.requestManager.schedule(request, 1)
            const html = response.data as string
            const $ = this.cheerio.load(html)

            // Extract images from .article-fulltext p img
            $('.article-fulltext p img').each((i, element) => {
                const src = $(element).attr('src')
                if (src && this.isValidImageUrl(src)) {
                    pages.push(src)
                }
            })

            // Get total pages from pagination or title
            if (currentPage === 1) {
                const titleText = $('.article-header h1').text()
                const pageMatch = titleText.match(/Page\s+(\d+)\s*\/\s*(\d+)/i)
                if (pageMatch && pageMatch[2]) {
                    totalPages = parseInt(pageMatch[2])
                }

                // Alternative: check pagination links
                if (!totalPages) {
                    const pages = $('.pagination-list .pagination-link')
                        .toArray()
                        .map(el => parseInt($(el).text()))
                        .filter(n => !isNaN(n))
                    if (pages.length > 0) {
                        totalPages = Math.max(...pages)
                    }
                }
            }

            currentPage++

            // Safety limit to prevent infinite loops
            if (currentPage > 10) break
        }

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const searchUrl = `/?search=${encodeURIComponent(query.title || '')}&start=${(page - 1) * 20}`
        const request = App.createRequest({
            url: this.BASE_URL + searchUrl,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const html = response.data as string
        const $ = this.cheerio.load(html)
        const results: PartialSourceManga[] = []

        // Parse search results - same structure as homepage
        $('.items-row').each((i, element) => {
            const title = $(element).find('.page-header h2 a').text().trim()
            const href = $(element).find('.item-link').attr('href')
            const thumbnail = $(element).find('.item-thumb img').attr('src')

            if (title && href) {
                results.push(
                    App.createPartialSourceManga({
                        mangaId: href,
                        title: title,
                        image: thumbnail || ''
                    })
                )
            }
        })

        return App.createPagedResults({
            results: results,
            metadata: results.length > 0 ? { page: page + 1 } : undefined
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        // BuonDua has a single gallery feed, not separate "Latest" and "Popular" sections
        const request = App.createRequest({
            url: this.BASE_URL + '/',
            method: 'GET'
        })

        const section = App.createHomeSection({
            id: 'latest',
            title: 'Latest Galleries',
            containsMoreItems: false,
            type: HomeSectionType.featured
        })

        sectionCallback(section)

        const response = await this.requestManager.schedule(request, 1)
        const html = response.data as string
        const $ = this.cheerio.load(html)
        const items: PartialSourceManga[] = []

        // Parse gallery items from homepage - .items-row with .item-link and .item-thumb img
        $('.items-row').each((i, element) => {
            const href = $(element).find('.item-link').attr('href')
            const title = $(element).find('.page-header h2 a').text().trim()
            const thumbnail = $(element).find('.item-thumb img').attr('src')

            if (href && title) {
                items.push(
                    App.createPartialSourceManga({
                        mangaId: href,
                        title: title,
                        image: thumbnail || ''
                    })
                )
            }
        })

        section.items = items
        sectionCallback(section)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        return App.createPagedResults({ results: [] })
    }

    // Utility
    private isValidImageUrl(url: string): boolean {
        // Remove query parameters for extension check
        const urlWithoutQuery = url.split('?')[0]
        return /\.(jpe?g|png|webp|gif)$/i.test(urlWithoutQuery) &&
               !url.includes('thumbnail') &&
               !url.includes('small') &&
               !url.includes('icon') &&
               !url.includes('logo')
    }
}

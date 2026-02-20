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
    HomePageSectionsProviding,
    BadgeColor
} from '@paperback/types'

import popularTagsData from './tags.json'

const BASE_URL = 'https://buondua.com'

export const BuonDuaInfo: SourceInfo = {
    author: 'FantomSloth',
    description: 'BuonDua manga source extension for Paperback',
    icon: 'icon.png',
    name: 'BuonDua',
    version: '1.0.5',
    authorWebsite: 'https://github.com/fantomthesloth',
    websiteBaseURL: BASE_URL,
    contentRating: ContentRating.ADULT,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.YELLOW
        }
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.SETTINGS_UI | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
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
                    'Referer': 'https://buondua.com/',
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
        // Convert popular tags from JSON to Tag objects
        const popularTags: Tag[] = popularTagsData.popularTags.map(tag => 
            App.createTag({ id: tag.id, label: tag.label })
        )
        
        return [App.createTagSection({ id: 'popular', label: 'Popular Tags', tags: popularTags })]
    }

    async supportsSearchOperators(): Promise<boolean> {
        return false
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    CloudFlareError(status: number): void {
        if (status === 503 || status === 403) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of BuonDua and press the cloud icon.`)
        }
    }

    async getCloudflareBypassRequest(): Promise<Request> {
        return App.createRequest({
            url: this.BASE_URL,
            method: 'GET',
            headers: {
                'referer': `${this.BASE_URL}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)

        const html = response.data as string
        const $ = this.cheerio.load(html)

        const title = $('.article-header h1').first().text().trim() || $('h1').first().text().trim()
        const thumbnail = $('meta[property="og:image"]').attr('content') || ''
        const description = $('meta[property="og:description"]').attr('content') || 'No description available'

        const tags: Tag[] = []
        $('.article-tags .tag').each((i, element) => {
            const tagName = $(element).text().trim()
            // Extract tag ID from href: /tag/pure-media-10876 -> pure-media-10876
            const tagHref = $(element).attr('href') || ''
            const tagId = tagHref.replace('/tag/', '').trim()
            
            if (tagName && tagId) {
                tags.push(App.createTag({
                    id: tagId,
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
        return [
            App.createChapter({
                id: '1',
                name: 'Gallery',
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

        while (currentPage <= totalPages) {
            const url = currentPage === 1
                ? (mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId)
                : (mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId) + `?page=${currentPage}`

            const request = App.createRequest({
                url: url,
                method: 'GET'
            })

            const response = await this.requestManager.schedule(request, 1)
            this.CloudFlareError(response.status)
            
            const html = response.data as string
            const $ = this.cheerio.load(html)

            $('.article-fulltext p img').each((i, element) => {
                const src = $(element).attr('src')
                if (src && this.isValidImageUrl(src)) {
                    pages.push(src)
                }
            })

            if (currentPage === 1) {
                const titleText = $('.article-header h1').text()
                const pageMatch = titleText.match(/Page\s+(\d+)\s*\/\s*(\d+)/i)
                if (pageMatch && pageMatch[2]) {
                    totalPages = parseInt(pageMatch[2])
                }

                if (!totalPages) {
                    const pageLinks = $('.pagination-list .pagination-link')
                        .toArray()
                        .map(el => parseInt($(el).text()))
                        .filter(n => !isNaN(n))
                    if (pageLinks.length > 0) {
                        totalPages = Math.max(...pageLinks)
                    }
                }
            }

            currentPage++
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
        let searchQuery = query.title || ''
        
        // Check if searching by tag
        const hasTags = query.includedTags && query.includedTags.length > 0
        
        let searchUrl: string
        
        if (hasTags) {
            // Use tag endpoint: /tag/tag-id
            // For multiple tags, use the first one (BuonDua doesn't support multi-tag filtering)
            const tagId = query.includedTags[0].id
            searchUrl = `/tag/${tagId}?start=${(page - 1) * 20}`
            
            // Add text query if also provided
            if (searchQuery) {
                searchUrl = `/?search=${encodeURIComponent(searchQuery)}&start=${(page - 1) * 20}`
            }
        } else {
            // Regular search
            searchUrl = `/?search=${encodeURIComponent(searchQuery)}&start=${(page - 1) * 20}`
        }
        
        const request = App.createRequest({
            url: this.BASE_URL + searchUrl,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        
        const html = response.data as string
        const $ = this.cheerio.load(html)
        const results: PartialSourceManga[] = []

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
        const sections = [
            {
                id: 'hot',
                title: 'Hot Albums 🔥',
                url: this.BASE_URL + '/hot/',
                type: HomeSectionType.singleRowNormal
            },
            {
                id: 'latest',
                title: 'Latest Galleries',
                url: this.BASE_URL + '/',
                type: HomeSectionType.singleRowNormal
            }
        ]

        const promises: Promise<void>[] = []

        for (const sectionConfig of sections) {
            const section = App.createHomeSection({
                id: sectionConfig.id,
                title: sectionConfig.title,
                containsMoreItems: true,
                type: sectionConfig.type
            })

            sectionCallback(section)

            const request = App.createRequest({
                url: sectionConfig.url,
                method: 'GET'
            })

            promises.push(
                this.requestManager.schedule(request, 1)
                    .then((response) => {
                        this.CloudFlareError(response.status)
                        
                        const html = response.data as string
                        const $ = this.cheerio.load(html)
                        const items: PartialSourceManga[] = []

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
                    })
                    .catch((error) => {
                        console.error(`Failed to load section ${sectionConfig.id}:`, error)
                    })
            )
        }

        await Promise.all(promises)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        let url = ''
        
        switch (homepageSectionId) {
            case 'hot':
                url = `${this.BASE_URL}/hot/?start=${(page - 1) * 20}`
                break
            case 'latest':
            default:
                url = `${this.BASE_URL}/?start=${(page - 1) * 20}`
                break
        }
        
        const request = App.createRequest({
            url: url,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        
        const html = response.data as string
        const $ = this.cheerio.load(html)
        const results: PartialSourceManga[] = []

        $('.items-row').each((i, element) => {
            const href = $(element).find('.item-link').attr('href')
            const title = $(element).find('.page-header h2 a').text().trim()
            const thumbnail = $(element).find('.item-thumb img').attr('src')

            if (href && title) {
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

    private isValidImageUrl(url: string): boolean {
        const urlWithoutQuery = url.split('?')[0]
        return /\.(jpe?g|png|webp|gif)$/i.test(urlWithoutQuery) &&
               !url.includes('thumbnail') &&
               !url.includes('small') &&
               !url.includes('icon') &&
               !url.includes('logo')
    }
}

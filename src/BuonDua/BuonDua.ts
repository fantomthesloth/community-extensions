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

import { load } from 'cheerio'

const BASE_URL = 'https://buondua.com'

export const BuonDuaInfo: SourceInfo = {
    author: 'Cline',
    description: 'BuonDua manga source extension for Paperback',
    icon: 'icon.png',
    name: 'BuonDua',
    version: '1.0.0',
    authorWebsite: 'https://github.com/cline',
    websiteBaseURL: BASE_URL,
    contentRating: ContentRating.ADULT,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.SETTINGS_UI
}

export class BuonDua implements ChapterProviding, SearchResultsProviding, HomePageSectionsProviding {
    BASE_URL = BASE_URL

    stateManager = App.createSourceStateManager()

    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request) => {
                request.headers = {
                    ...request.headers,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Referer': 'https://www.google.com/'
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
        const $ = load(html)

        // Extract title
        const title = $('h1').first().text().trim()

        // Extract thumbnail
        const thumbnail = $('meta[property="og:image"]').attr('content') || ''

        // Extract description
        const description = $('meta[property="og:description"]').attr('content') || 'No description available'

        // Extract tags
        const tags: Tag[] = []
        $('.tag').each((i, element) => {
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
                status: 'Finished', // BuonDua galleries are typically complete
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
        const request = App.createRequest({
            url: mangaId.startsWith('http') ? mangaId : this.BASE_URL + mangaId,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const html = response.data as string
        const $ = load(html)
        const pages: string[] = []

        // Extract all gallery images
        $('img.gallery-image').each((i, element) => {
            const src = $(element).attr('src') || $(element).attr('data-src')
            if (src && this.isValidImageUrl(src)) {
                pages.push(src)
            }
        })

        // Fallback: try to find images in article content
        if (pages.length === 0) {
            $('.article-content img').each((i, element) => {
                const src = $(element).attr('src') || $(element).attr('data-src')
                if (src && this.isValidImageUrl(src)) {
                    pages.push(src)
                }
            })
        }

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const searchUrl = `/search?q=${encodeURIComponent(query.title || '')}&page=${page}`
        const request = App.createRequest({
            url: this.BASE_URL + searchUrl,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const html = response.data as string
        const $ = load(html)
        const results: PartialSourceManga[] = []

        // Parse search results
        $('.gallery-item').each((i, element) => {
            const title = $(element).find('.title').text().trim()
            const href = $(element).find('a').attr('href')
            const thumbnail = $(element).find('img').attr('src')

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
                request: App.createRequest({
                    url: this.BASE_URL + '/',
                    method: 'GET'
                }),
                section: App.createHomeSection({
                    id: 'latest',
                    title: 'Latest Galleries',
                    containsMoreItems: false,
                    type: HomeSectionType.featured
                })
            },
            {
                request: App.createRequest({
                    url: this.BASE_URL + '/',
                    method: 'GET'
                }),
                section: App.createHomeSection({
                    id: 'popular',
                    title: 'Popular Galleries',
                    containsMoreItems: false,
                    type: HomeSectionType.singleRowNormal
                })
            }
        ]

        const promises: Promise<void>[] = []

        for (const section of sections) {
            sectionCallback(section.section)
            promises.push(
                this.requestManager.schedule(section.request, 1).then(async (response) => {
                    const html = response.data as string
                    const $ = load(html)
                    const items: PartialSourceManga[] = []

                    // Parse gallery links from homepage
                    $('a[href*="/gallery/"]').each((i, element) => {
                        const href = $(element).attr('href')
                        const title = $(element).text().trim()

                        if (href && title) {
                            items.push(
                                App.createPartialSourceManga({
                                    mangaId: href,
                                    title: title,
                                    image: ''
                                })
                            )
                        }
                    })

                    section.section.items = items
                    sectionCallback(section.section)
                })
            )
        }

        await Promise.all(promises)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        return App.createPagedResults({ results: [] })
    }

    // Utility
    private isValidImageUrl(url: string): boolean {
        return /\.(jpe?g|png|webp|gif)$/i.test(url) &&
               !url.includes('thumbnail') &&
               !url.includes('small') &&
               !url.includes('icon') &&
               !url.includes('logo')
    }
}
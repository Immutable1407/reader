package reader

import (
	"regexp"
	"strings"
)

var documentCitationPattern = regexp.MustCompile(`\[S[1-9][0-9]*\]|(?:cite|filecite)[^]*(?:|$)`)
var documentSourceIDPattern = regexp.MustCompile(`^S[1-9][0-9]*$`)

// Provider markers and Reader labels resolve through the same evidence check.
// Unknown IDs, malformed markers and unfinished citations never bypass it.
func documentCitationSources(text string) ([]string, error) {
	sources := []string{}
	for _, marker := range documentCitationPattern.FindAllString(text, -1) {
		if strings.HasPrefix(marker, "[") {
			sources = append(sources, marker[1:len(marker)-1])
			continue
		}
		if !strings.HasSuffix(marker, "") {
			return nil, generationError(ErrorProtocol, "回答的来源标记不完整，请重试")
		}
		for _, source := range strings.Split(strings.TrimSuffix(marker, ""), "")[1:] {
			if !documentSourceIDPattern.MatchString(source) {
				return nil, generationError(ErrorProtocol, "回答包含无法识别的来源，请重试")
			}
			sources = append(sources, source)
		}
	}
	return sources, nil
}

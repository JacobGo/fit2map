#include <iostream>
#include <fit_decode.hpp>

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: fit2map <input.fit> [input2.fit ...]\n";
        return 1;
    }

    return 0;
}
